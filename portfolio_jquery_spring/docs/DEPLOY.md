# AWS 배포 가이드 (EC2 + Docker MySQL + Nginx)

프리티어 기준. 구성: 사용자 -> EC2(Nginx 리버스 프록시 -> Spring Boot jar, systemd) -> 같은 EC2 의 Docker MySQL 8.
(프리티어 비용과 단일 인스턴스 규모를 고려해 RDS 대신 EC2 내 Docker MySQL 을 사용합니다 - README "DB 선택" 참조.)

> 본 문서는 배포 절차 문서입니다. 실제 인프라 생성은 배포자의 AWS 계정/크리덴셜로 수행합니다.

```
[사용자] -> [EC2 t2.micro : Nginx :80/:443] -> [Spring Boot :8080] -> [Docker MySQL :3306 (루프백)]
```

---

## 1. MySQL 8 (EC2 내 Docker 컨테이너)
- Docker 컨테이너로 MySQL 8 기동, **127.0.0.1:3306 에만 바인딩**(외부 미개방, 앱과 같은 호스트)
  ```bash
  docker run -d --name extdb-mysql --restart unless-stopped \
    -p 127.0.0.1:3306:3306 \
    -e MYSQL_DATABASE=extdb -e MYSQL_ROOT_PASSWORD=<password> \
    -v extdb-data:/var/lib/mysql mysql:8.0
  ```
- **스키마/시드는 수동 적용이 필요 없습니다.** 앱이 `prod` 프로파일로 기동할 때 **Flyway**가
  `db/migration`(V1 스키마 · V2 고정 확장자 시드)을 자동 적용하고, Hibernate `ddl-auto=validate`가
  엔티티-스키마 정합을 검증합니다. 기존 데이터가 있는 DB 에는 `baseline-on-migrate`로 안전하게 도입됩니다.

## 2. EC2 (Ubuntu, 프리티어)
- `t2.micro` + **Elastic IP**(재부팅 시 IP 유지 -> 면접 당일까지 안정적)
- 보안그룹 인바운드: 22(내 IP), 80, 443 만 오픈. 8080 은 외부에 열지 않음(Nginx만 프록시)
- JDK 21 설치: `sudo apt update && sudo apt install -y openjdk-21-jre-headless nginx`

## 3. 빌드 & 업로드
```bash
./gradlew clean build
scp build/libs/extension-block-0.0.1-SNAPSHOT.jar ubuntu@<eip>:/home/ubuntu/app.jar
```

## 4. systemd 서비스 (재부팅 자동 기동)
`/etc/systemd/system/extension-block.service`:
```ini
[Unit]
Description=Extension Block Service
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStart=/usr/bin/java -jar /home/ubuntu/app.jar --spring.profiles.active=prod
Environment=DB_HOST=127.0.0.1
Environment=DB_PORT=3306
Environment=DB_NAME=extdb
Environment=DB_USER=<user>
Environment=DB_PASSWORD=<password>
SuccessExitStatus=143
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now extension-block
sudo systemctl status extension-block
```
> 시크릿을 유닛 파일에 직접 두는 대신 `EnvironmentFile=/etc/extension-block.env`(권한 600)로 분리 권장.

## 5. Nginx 리버스 프록시
`/etc/nginx/sites-available/extension-block`:
```nginx
server {
    listen 80;
    server_name <eip-or-domain>;

    client_max_body_size 10M;   # 파일 검증 데모 업로드 여유

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/extension-block /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. HTTPS

### 6-1. 도메인 없이 (현재 이 배포가 쓰는 방식)
Let's Encrypt 는 2026-01-15 부터 **IP 주소 인증서**를 정식 발급한다. 도메인 없이 `https://<eip>` 가능.
저장소의 스크립트가 발급 → nginx 구성 → 자동 갱신 → 검증까지 수행한다(실패 시 HTTP 로 자동 롤백).

```bash
scp -i ~/.ssh/<키>.pem scripts/setup-tls-ip.sh ubuntu@<eip>:/home/ubuntu/
ssh -i ~/.ssh/<키>.pem ubuntu@<eip> 'sudo bash /home/ubuntu/setup-tls-ip.sh'
```

주의할 제약(자세한 근거는 [README](../README.md) 16번, 운영은 [HANDOFF](HANDOFF.md) 7번):
- 인증서 수명이 **160시간(약 6일)** 로 강제된다(`shortlived` 프로필). **자동 갱신이 생명.**
- **dns-01 불가** → http-01 만 가능. 80번의 `/.well-known/acme-challenge/` 를 절대 막지 말 것.
- certbot 은 **5.3+** 필요(`--ip-address`). Ubuntu apt 판(2.x)은 미지원 → snap 설치.
- IP 리터럴은 SNI 를 보내지 않으므로 443 블록이 `default_server` 여야 한다.
- HSTS 는 IP 호스트에 적용되지 않고, 단수명 인증서라 OCSP stapling 도 불필요.

### 6-2. 도메인이 있다면 (더 안전한 대안)
90일 인증서 + `certbot --nginx` 자동 설치/갱신이 되고 HSTS 도 쓸 수 있다.
무료 서브도메인은 **DuckDNS**(https://www.duckdns.org) 권장 — Public Suffix List 에 등재되어 있어
Let's Encrypt 레이트리밋이 서브도메인별로 분리된다(sslip.io/nip.io 는 미등재라 쿼터 공유 → 발급 실패 사례).
```bash
sudo snap install --classic certbot
sudo certbot --nginx -d <domain>       # 발급 + nginx 설치 + 자동 갱신
```

## 7. 배포 체크리스트
- [ ] RDS 보안그룹: 3306 은 EC2 보안그룹에서만
- [ ] EC2 보안그룹: 80/443/22(내 IP)만, 8080 미개방
- [ ] Elastic IP 연결(재부팅 IP 고정)
- [ ] systemd `enable`(재부팅 자동 기동) 확인
- [ ] `nginx -t` 통과 + `client_max_body_size` 설정
- [ ] 시크릿은 EnvironmentFile(600)로 분리
- [ ] **면접 당일까지 인스턴스 유지** - 프리티어 과금/중지 여부 주기 확인
- [ ] 헬스 체크: `curl https://<eip>/actuator/health`
- [ ] TLS 적용 시: `certbot renew --dry-run` 통과 + 만료일 확인(6일 인증서라 갱신이 생명)

> 더 간단히 가려면 EC2 1대에 Docker Compose(app + MySQL)로 묶어도 됨. 단 RDS를 쓰면
> "AWS RDB 서비스 경험"을 더 명확히 어필할 수 있음.
