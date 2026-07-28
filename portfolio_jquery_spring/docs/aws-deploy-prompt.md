# AWS 배포 실행 프롬프트

> AWS 자격증명이 구성된 배포용 세션(Claude Code 등)에 아래 블록을 그대로 붙여넣어 사용합니다.
> 절차 문서는 [DEPLOY.md](DEPLOY.md) 참고.

---

너는 이 프로젝트(포트폴리오 모노레포의 `portfolio_jquery_spring` 서브폴더, Spring Boot 파일
확장자 차단 서비스)를 **AWS 프리티어에 실제 배포**하는 작업을 맡는다. 이하 모든 상대 경로
(`docs/`, `src/`, `scripts/`, `build/`)와 `./gradlew` 는 이 서브폴더 기준이다. 목표 구성:

```
[사용자] -> EC2 t2.micro (Nginx :80 리버스 프록시 -> Spring Boot :8080, systemd) -> RDS MySQL 8 :3306
```

절차 문서 `docs/DEPLOY.md`가 저장소에 있으니 **먼저 읽고 그대로 따르되**, 아래 규칙과
이 앱 특유의 함정을 반드시 반영하라.

## 반드시 지킬 안전 규칙
- **AWS 계정 생성, 결제수단(카드) 입력, 콘솔 로그인 비밀번호 입력은 하지 말 것.** 이미 구성된
  자격증명(`aws sts get-caller-identity`로 확인)만 사용한다. 없으면 나에게 설정을 요청하라.
- **과금이 발생하는 리소스(RDS, EC2, Elastic IP, EBS)를 생성하기 전에**, 생성할 목록과 예상
  월 비용(프리티어 초과 여부 포함)을 요약해 보여주고 **내 승인을 받은 뒤** 진행하라.
- **시크릿(DB 비밀번호 등)을 저장소 파일, git, systemd 유닛 본문에 절대 하드코딩하지 말 것.**
  `EnvironmentFile=/etc/extension-block.env`(권한 600, ubuntu 소유)로 분리한다.
- 보안그룹은 최소 권한: EC2 인바운드는 22(내 IP만)/80/443 만, **8080은 외부 미개방**.
  RDS 3306은 **EC2 보안그룹에서만** 허용, 퍼블릭 액세스 비활성화.
- 파괴적/비가역 작업(리소스 삭제, 보안그룹 광범위 개방 등) 전에는 확인을 받아라.

## 이 앱 특유의 함정 (놓치면 배포 실패)
1. **prod 스키마는 Flyway 가 자동으로 만든다.** `spring.jpa.hibernate.ddl-auto: validate` 라 앱이
   스키마를 *생성*하진 않지만, 기동 시 **Flyway 가 `db/migration`(V1 스키마 + V2 고정 확장자 시드)을
   자동 적용**한 뒤 validate 가 엔티티-스키마 정합을 검증한다. 따라서 **수동 스키마 적용은 불필요**하다
   (구 `mysql-schema.sql` 방식 폐지). 빈 DB 는 그대로 기동하면 되고, 기존 데이터가 있는 DB 는
   `spring.flyway.baseline-on-migrate: true`(prod 설정에 포함)로 안전하게 베이스라인된다. 낙관적 락
   컬럼 `fixed_extension.version BIGINT NOT NULL DEFAULT 0` 도 V1 에 포함돼 있다.
2. **필수 환경변수**(systemd EnvironmentFile에 넣기): `DB_HOST`, `DB_PORT`(3306),
   `DB_NAME`(extdb), `DB_USER`, `DB_PASSWORD`.
3. **실행 커맨드**: `java -jar /home/ubuntu/app.jar --spring.profiles.active=prod`
   (JDK 21 필요: `openjdk-21-jre-headless`). jar 파일명은
   `build/libs/extension-block-0.0.1-SNAPSHOT.jar`.
4. **헬스체크 엔드포인트는 `/actuator/health`** (-> `{"status":"UP"}`). systemd 기동 확인,
   로드밸런서, 배포 스모크에 이걸 사용하라(문서의 옛 `/api/extensions/fixed`보다 우선).
5. **파일 검증 데모 업로드**가 있으므로 Nginx `client_max_body_size`를 최소 5MB 이상(문서 예시
   10M)으로 설정. 앱의 멀티파트 상한도 5MB이며 초과 시 413을 반환한다.
6. **보안 응답 헤더는 애플리케이션(`SecurityHeadersFilter`)이 설정**한다(CSP, nosniff,
   X-Frame-Options, Referrer-Policy). Nginx에서 이 헤더를 덮어쓰거나 중복 추가하지 말고
   **그대로 통과**시켜라. 배포 후 `curl -I`로 CSP 헤더가 살아있는지 확인.

## 진행 순서
1. 사전 점검: `aws sts get-caller-identity`, 리전 확인, 로컬 `./gradlew clean build`로 jar 생성 +
   `./gradlew test`(51개 그린) 통과 확인.
2. 생성 리소스, 비용 요약 -> **내 승인**.
3. RDS(MySQL 8, db.t3.micro, extdb, 퍼블릭 비활성) 생성 -> 스키마 적용(위 함정 1).
   - (비용 절감 대안: RDS 대신 EC2 안에 Docker MySQL. 단 "AWS RDB 경험" 어필은 RDS가 유리 -
     어느 쪽을 원하는지 물어보고 결정.)
4. EC2(Ubuntu, t2.micro) + Elastic IP + 보안그룹(위 규칙) 생성. JDK 21 + Nginx 설치.
5. jar 업로드(`scp`), `/etc/extension-block.env`(600) 작성, systemd 유닛 등록 ->
   `enable --now`(재부팅 자동 기동), `status`로 기동 확인.
6. Nginx 리버스 프록시(80 -> 127.0.0.1:8080) 설정, `nginx -t` 통과 후 reload.
7. (도메인 있으면) certbot으로 HTTPS.
8. **배포 검증 스모크**(모두 통과해야 완료):
   ```bash
   curl -s http://<eip>/actuator/health                      # {"status":"UP"}
   curl -sI http://<eip>/ | grep -i content-security-policy   # CSP 헤더 존재
   curl -s http://<eip>/api/extensions/fixed                  # 고정 7종 목록
   curl -s -X POST http://<eip>/api/extensions/custom \
        -H 'Content-Type: application/json' -d '{"name":"sh"}' # 201
   ```
9. 마무리: 접속 URL(Elastic IP/도메인) 보고 + `docs/DEPLOY.md` 체크리스트 대조.
   **면접 당일까지 인스턴스를 유지**할 것과 프리티어 과금 주의를 안내하라.

각 단계에서 실제 실행한 명령과 결과(성공/실패)를 사실 그대로 보고하고, 실패 시 멈추고
원인과 함께 물어봐라. 완료 후 접속 URL과 헬스체크 결과를 한글로 요약해서 알려줘.
