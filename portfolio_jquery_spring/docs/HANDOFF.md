# 작업 인계 / 운영 런북

다른 PC에서 이어서 작업하기 위한 문서. 프로젝트 설명은 [README](../README.md),
최초 배포 절차는 [DEPLOY.md](DEPLOY.md) 참고.

> 이 문서에는 비밀번호, 액세스 키, 개인 IP를 적지 않는다.
> 필요한 값은 실행 시점에 조회하도록 명령을 구성했다.

---

## 1. 현재 상태

| 항목 | 상태 |
|------|------|
| 저장소 | `origin/main` 동기화 완료 |
| 라이브 데모 | **https://52.79.154.220** (HTTP 접속은 301 리다이렉트) |
| TLS | Let's Encrypt **IP 주소 인증서**(160시간) · 6시간 주기 자동 갱신 → **7번** |
| 테스트 | `./gradlew test` 전체 그린 |
| 남은 일 | 면접 후 AWS 리소스 종료, 아래 보안 체크리스트 |

---

## 2. 새 PC에서 시작하기

### 필수 도구
- **JDK 21** (필수. Spring Boot 4.1 요건)
- **Git**
- Node 22+ / npm (프론트 번들 재빌드할 때만. Gradle이 자동 다운로드도 가능)

### 클론 & 실행
이 프로젝트는 포트폴리오 모노레포의 `portfolio_jquery_spring` 서브폴더에 있다.
아래 명령과 `gradlew` 는 모두 이 서브폴더 안에서 실행한다.
```bash
git clone https://github.com/vkdnj20088/portfolio.git
cd portfolio/portfolio_jquery_spring

./gradlew bootRun        # H2 인메모리로 실행 -> http://localhost:8080
./gradlew test           # 전체 테스트
./gradlew clean bootJar  # 배포용 jar (build/libs/*.jar)
```

Java 버전 확인:
```bash
java -version                  # 21 이어야 함
/usr/libexec/java_home -V      # (macOS) 설치된 JDK 목록
```

### 프론트엔드 수정 시
`frontend/src/` 의 `*.ts` **또는 `styles/*.scss`** 를 고쳤다면 재빌드해야 화면에 반영된다.
스타일도 webpack 산출물이므로 `static/css/*.css` 를 직접 고치지 말 것(재빌드 시 덮어써짐).
```bash
cd frontend && npm ci && npm run build   # -> static/js/bundle.<hash>.js + static/css/style.<hash>.css
# 또는
./gradlew webpackBuild                   # Gradle 이 로컬 Node 자동 다운로드
```
해시가 바뀌어도 nginx 캐시 스크립트를 다시 돌릴 필요는 없다. `cache.conf` 의 map 이 파일명을
하드코딩하지 않고 정규식(`~^/css/style\.[0-9a-f]+\.css$`)으로 잡으므로 **새 해시도 자동으로 매칭**된다.
산출물은 무설정 실행을 위해 저장소에 커밋한다. 재빌드 후 **함께 커밋할 것**:
- `src/main/resources/static/js/bundle.<hash>.js` (+ `.LICENSE.txt` 사이드카) — 옛 해시 파일은 자동 삭제됨
- `src/main/resources/static/index.html` — **생성물**이다. 해시된 번들명이 주입되므로
  **직접 수정하지 말 것**(수정은 템플릿 `frontend/src/index.html` 에서). 개발자 주석은 템플릿에만 남는다.

---

## 3. 지금까지 완료된 작업

| 영역 | 내용 |
|------|------|
| 기능 | 고정 확장자 토글, 커스텀 확장자 CRUD(정규화/중복/200 상한/동시성), Magic Number 파일검증 데모 |
| 하드닝 | Bean Validation, CSP 등 보안 헤더 필터, `@Version` 낙관적 락, Actuator, 멀티파트 상한 |
| 테스트 | 서비스/정규화/동시성/파일검증 + `@WebMvcTest` 컨트롤러 계약 + 보안헤더 (전체 그린) |
| 스택 | Spring Boot 4.1 + Java 21 + Gradle 9.6 마이그레이션, jQuery 4, TypeScript 6 + webpack |
| 빌드 | Terser 난독화(`mangle.toplevel`) + `drop_console` + 주석 제거, jQuery MIT 라이선스는 사이드카 분리 |
| UI | 브랜드 컬러핏, 최상단 포트폴리오 식별 배너, 파비콘(svg + ico) |
| 문서 | README "요건 외 고려사항" 19개 항목 |
| 캐시 | 콘텐츠 해시(`bundle.<hash>.js`) + `immutable` 장기 캐시 / HTML·CSS 는 `no-cache`(304). **해시된 것만 캐시** |
| 배포 | AWS EC2 + Docker MySQL + Nginx, 라이브 검증 완료 |
| TLS | 도메인 없이 **베어 IP HTTPS**(LE IP 인증서 160시간) + 자동 갱신 + nginx 리로드 훅 |
| 압축 | nginx gzip 확장(기본값은 text/html 뿐이었음) — 전송량 88.4KB → 32.1KB(64%↓). brotli 는 실측 2% 이득뿐이라 미도입 |

---

## 4. 운영 구성 (AWS)

```
[인터넷] --> Nginx :80 --> 127.0.0.1:8080 (Spring Boot, systemd)
                                  |
                          Docker MySQL 8 (127.0.0.1:3306)
```

| 리소스 | 값 |
|--------|-----|
| 리전 | `ap-northeast-2` (서울) |
| EC2 | `i-07b89aec7c0aac8c9` (t3.micro, Ubuntu 24.04, swap 2GB) |
| Elastic IP | `52.79.154.220` (할당 ID `eipalloc-0b1b383d67c8862b8`) |
| 보안그룹 | `sg-046769b3fbd80392a` (22: 지정 IP만 / 80, 443: 공개 / 3306, 8080: 차단) |
| 키페어 | `extblock-key` |
| systemd 서비스 | `extension-block` (JVM `-Xmx320m`) |
| 앱 jar | `/home/ubuntu/app.jar` (직전 버전: `app.jar.bak`) |
| 환경변수 | `/etc/extension-block.env` (권한 600, DB 접속정보) |
| DB | Docker MySQL 8, DB `extdb`, 볼륨 `mysql-data` (localhost 전용) |

`aws` 명령은 **AWS CloudShell**(브라우저)에서 실행하거나, 로컬에 `aws configure` 로 설정 후 실행한다.

---

## 5. 새 PC(집)에서 서버에 접속하기

SSH(22번)는 **지정한 IP만 허용**하는 화이트리스트다. 집 IP는 기존과 다르므로 규칙 추가가 필요하다.

### 5-1. SSH 키 옮기기

`extblock-key.pem` 은 **개인키**다.

- **git / 이메일 / 메신저로 옮기지 말 것**
- 안전한 방법: USB, AirDrop, 비밀번호 관리자의 보안 파일 첨부
- 새 PC에 둔 뒤 권한을 조여야 SSH 가 키를 받아준다:

```bash
mkdir -p ~/.ssh && mv extblock-key.pem ~/.ssh/
chmod 400 ~/.ssh/extblock-key.pem
```

> 키를 분실하면 SSH 접속이 불가능하다. 그 경우 새 키페어를 만들어 인스턴스를 다시 만들거나
> EC2 Instance Connect / SSM Session Manager 를 설정해야 한다.

### 5-2. 집 IP를 보안그룹에 추가

**새 PC 터미널**에서 현재 공인 IP 확인:
```bash
curl -s https://checkip.amazonaws.com
```

**CloudShell** 에서 위 IP를 넣어 규칙 추가:
```bash
export AWS_PAGER=""
HOME_IP=<위에서 확인한 IP>

aws ec2 authorize-security-group-ingress \
  --group-id sg-046769b3fbd80392a \
  --protocol tcp --port 22 --cidr ${HOME_IP}/32
```

새 PC에 `aws` CLI 를 설정했다면 한 줄로도 가능:
```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-046769b3fbd80392a --protocol tcp --port 22 \
  --cidr $(curl -s https://checkip.amazonaws.com)/32
```

현재 열린 규칙 확인:
```bash
aws ec2 describe-security-groups --group-ids sg-046769b3fbd80392a \
  --query 'SecurityGroups[0].IpPermissions' --output json
```

더 이상 쓰지 않는 이전 IP 규칙 정리(선택):
```bash
aws ec2 revoke-security-group-ingress \
  --group-id sg-046769b3fbd80392a --protocol tcp --port 22 --cidr <이전IP>/32
```

> 가정용 회선은 공인 IP가 바뀔 수 있다. 접속이 안 되면 IP를 다시 확인해 규칙을 추가한다.
> 규칙이 쌓이면 위 `revoke` 로 정리한다.

### 5-3. 접속 확인
```bash
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 'uptime; systemctl is-active extension-block'
```

---

## 6. 재배포

코드를 고친 뒤 라이브에 반영하는 절차. **실행 중인 jar 를 직접 덮어쓰지 말고** `.new` 로 올린 뒤 교체한다.

```bash
# 1) 빌드 (프론트를 고쳤다면 npm run build 를 먼저)
./gradlew clean bootJar

# 2) 업로드
scp -i ~/.ssh/extblock-key.pem \
  build/libs/extension-block-0.0.1-SNAPSHOT.jar \
  ubuntu@52.79.154.220:/home/ubuntu/app.jar.new

# 3) 교체 + 재시작 (직전 버전은 app.jar.bak 으로 백업)
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 '
  sudo systemctl stop extension-block &&
  mv /home/ubuntu/app.jar /home/ubuntu/app.jar.bak &&
  mv /home/ubuntu/app.jar.new /home/ubuntu/app.jar &&
  sudo systemctl start extension-block'

# 4) 검증 (기동에 10~15초)
curl -s https://52.79.154.220/actuator/health
```

**롤백**
```bash
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 '
  sudo systemctl stop extension-block &&
  mv /home/ubuntu/app.jar.bak /home/ubuntu/app.jar &&
  sudo systemctl start extension-block'
```

**로그 / 상태**
```bash
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 'journalctl -u extension-block -n 50 --no-pager'
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 'docker ps; free -h'
```

**배포 후 확인 목록**
```bash
curl -s https://52.79.154.220/actuator/health         # {"status":"UP"}
curl -s https://52.79.154.220/api/extensions/fixed    # 고정 7종
curl -sI https://52.79.154.220/ | grep -i content-security-policy
curl -sI http://52.79.154.220/ | head -1              # 301 (HTTPS 리다이렉트)
```

---

## 7. TLS 인증서(HTTPS) 운영

`https://52.79.154.220` 은 **Let's Encrypt IP 주소 인증서**로 서비스된다. 도메인이 없으므로 LE 가
`shortlived` 프로필(**160시간 ≈ 6.6일**)을 강제한다.
→ **자동 갱신이 멈추면 6일 안에 사이트가 만료된다.** 설계 근거는 [README](../README.md) 16번.

| 항목 | 값 |
|------|-----|
| 인증서 | `/etc/letsencrypt/live/52.79.154.220/` (fullchain.pem, privkey.pem) |
| 프로필 | `shortlived` (160시간), key_type `ecdsa` |
| 검증 방식 | **http-01** (webroot `/var/www/html`) — IP 에는 dns-01 사용 불가 |
| 갱신 타이머 | `snap.certbot.renew.timer` — **6시간 주기**(override), `Persistent=true` |
| 갱신 시점 | `renew_before_expiry = 2 days` + LE **ARI** 권고 |
| 갱신 후 훅 | `renew_hook = systemctl reload nginx` |
| nginx | `/etc/nginx/sites-available/extension-block` (80 리다이렉트 + 443 `default_server`) |
| 설치 스크립트 | `scripts/setup-tls-ip.sh` (재실행 가능, 실패 시 HTTP 로 자동 롤백) |

### 상태 확인
```bash
# 만료일 — 면접 전날 반드시 확인
echo | openssl s_client -connect 52.79.154.220:443 2>/dev/null | openssl x509 -noout -dates

# 외부 신뢰 검증 (-k 없이 200 / tls_verify=0 이어야 정상)
curl -s -o /dev/null -w '%{http_code} tls_verify=%{ssl_verify_result}\n' \
  https://52.79.154.220/actuator/health

# 갱신 리허설 · 타이머
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 'sudo certbot renew --dry-run'
ssh -i ~/.ssh/extblock-key.pem ubuntu@52.79.154.220 'systemctl list-timers snap.certbot.renew.timer'
```

### 절대 건드리면 안 되는 것
nginx 80번 블록의 `location ^~ /.well-known/acme-challenge/` 는 **갱신의 생명선**이다.
이 블록을 지우거나 HTTPS 리다이렉트 아래로 내리면 http-01 검증이 실패하고 6일 뒤 만료된다.
포트 80 을 보안그룹에서 닫아도 같은 결과가 된다.

### 수동 갱신 / 롤백
```bash
# 강제 갱신
sudo certbot renew --force-renewal && sudo systemctl reload nginx

# HTTPS 문제 시 HTTP 전용으로 즉시 복구 (백업본은 설치 시각별로 존재)
ls /etc/nginx/sites-available/extension-block.http-only.*
sudo cp -a /etc/nginx/sites-available/extension-block.http-only.<타임스탬프> \
  /etc/nginx/sites-available/extension-block
sudo nginx -t && sudo systemctl reload nginx
```

### 응답 압축(gzip)
설정은 `/etc/nginx/conf.d/compression.conf` 한 파일에만 있다(배포판 `nginx.conf` 는 수정하지 않음).
설치 스크립트는 `scripts/setup-compression.sh`, 설계 근거는 [README](../README.md) 17번.
```bash
# 확인 (번들 경로는 해시가 붙으므로 index.html 에서 뽑아 쓴다)
B=$(curl -s https://52.79.154.220/ | grep -oE '/js/bundle\.[0-9a-f]+\.js' | head -1)
curl -sI -H 'Accept-Encoding: gzip' "https://52.79.154.220$B" | grep -iE 'content-encoding|vary'

# 롤백은 파일 삭제로 끝난다
sudo rm -f /etc/nginx/conf.d/compression.conf && sudo nginx -t && sudo systemctl reload nginx
```

### 캐시 정책
설정은 `/etc/nginx/conf.d/cache.conf` 한 파일. 스크립트 `scripts/setup-cache-headers.sh`, 근거는
[README](../README.md) 18번. **원칙: 해시된 것만 캐시한다.**
`bundle.<hash>.js` → `immutable`(1년) / 나머지(HTML·CSS·favicon·API) → `no-cache`(항상 재검증 → 304).
```bash
# 확인: 번들은 immutable, HTML 은 no-cache 여야 정상
B=$(curl -s https://52.79.154.220/ | grep -oE '/js/bundle\.[0-9a-f]+\.js' | head -1)
curl -sI "https://52.79.154.220$B" | grep -i cache-control    # public, max-age=31536000, immutable
curl -sI https://52.79.154.220/    | grep -i cache-control    # no-cache

# 롤백
sudo rm -f /etc/nginx/conf.d/cache.conf && sudo nginx -t && sudo systemctl reload nginx
```
> 번들 파일명이 바뀌면(재배포) 브라우저는 새 URL 을 받으므로 캐시 무효화가 자동으로 성립한다.
> `index.html` 이 `no-cache` 인 이유가 여기 있다 — **새 번들 파일명을 알려주는 문서**이기 때문이다.

---

## 8. 문제 해결

| 증상 | 확인 |
|------|------|
| SSH 타임아웃 | 집 IP가 바뀌었는지 확인(5-2). 인스턴스가 running 인지 확인 |
| `Permission denied (publickey)` | `chmod 400` 적용 여부, 사용자명이 `ubuntu` 인지 |
| 502 Bad Gateway | 앱이 죽음. `journalctl -u extension-block -n 50` 확인 |
| 앱 기동 실패 | `/etc/extension-block.env` 의 DB 값, `docker ps` 로 MySQL 확인 |
| 메모리 부족(OOM) | `free -h` 로 swap 확인. JVM 은 `-Xmx320m` 고정 |
| 인증서 만료 경고(`NET::ERR_CERT_DATE_INVALID`) | 갱신이 멈춘 것. `sudo certbot renew --dry-run` 으로 원인 확인 → 대개 80번 ACME 경로가 막힘(7번). 급하면 `sudo certbot renew --force-renewal && sudo systemctl reload nginx` |
| HTTPS 접속 불가 | 보안그룹 443 개방 여부, `sudo ss -tlnp \| grep 443`, `sudo nginx -t` |
| 갱신은 됐는데 옛 인증서 | `renew_hook` 누락. `/etc/letsencrypt/renewal/52.79.154.220.conf` 에 `renew_hook = systemctl reload nginx` 확인 |

---

## 9. 면접 종료 후 리소스 정리

과금을 막으려면 반드시 실행한다 (CloudShell).
```bash
export AWS_PAGER=""
aws ec2 terminate-instances --instance-ids i-07b89aec7c0aac8c9
aws ec2 wait instance-terminated --instance-ids i-07b89aec7c0aac8c9
aws ec2 release-address --allocation-id eipalloc-0b1b383d67c8862b8
aws ec2 delete-security-group --group-id sg-046769b3fbd80392a
aws ec2 delete-key-pair --key-name extblock-key
```

비용 알림(선택):
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws budgets create-budget --account-id "$ACCOUNT_ID" \
  --budget '{"BudgetName":"extblock","BudgetLimit":{"Amount":"5","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"<이메일>"}]}]'
```
권한 오류가 나면 Billing 콘솔의 Budgets 에서 UI로 설정한다.

---

## 10. 보안 체크리스트

- [ ] 루트 계정 **MFA 활성화**, 강한 비밀번호 사용
- [ ] IAM 액세스 키는 **주기적으로 교체**하고, 쓰지 않는 키는 삭제
- [ ] 키/비밀번호를 저장소, 채팅, 이메일에 남기지 않기 (`.gitignore` 에 `*.pem`, `.env` 포함)
- [ ] SSH(22)는 필요한 IP만 열어두고, 쓰지 않는 규칙은 제거
- [ ] SSH(22) 화이트리스트에 안 쓰는 옛 IP 규칙이 남아있지 않은지 확인(5-2 의 `revoke`)
- [ ] 작업이 끝나면 9번의 리소스 정리 실행
