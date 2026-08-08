# infra - 통합 EC2 배포 (인트로 + 데모 여덟 화면)

한 대의 EC2 에서 인트로 랜딩과 데모를 함께 서빙하기 위한 코드화된 인프라입니다.
화면은 여덟이지만 앱은 다섯입니다 - 문서 QA 와 시맨틱 검색이 한 앱(docqa)의 두 라우트이고,
파일 차단 · IP 접근 제어 · 작업 릴레이가 한 앱(guard)의 세 화면입니다.
nginx 설정, systemd 유닛, 프로비저닝, 배포 파이프라인을 전부 버전관리 파일로 둡니다.

## 구성

| 파일 | 역할 |
|------|------|
| `nginx/portfolio.conf` | 포트별 리버스 프록시(443 인트로 · 8443 Guard · 9443 Chat · 9444 DocuQA · 9445 Exchange · 9446 LoanDoc) + 80 ACME/리다이렉트 |
| `nginx/portfolio-domain.conf` | **도메인(SNI) 기반** 라우팅 - 443 한 포트에서 서브도메인으로 가릅니다. 위 설정과 **함께** 켭니다 |
| `nginx/snippets/tls-domain.conf` | 도메인 인증서(표준 90일) 경로 - 도메인 블록들이 공유 |
| `nginx/snippets/hsts.conf` | HSTS 한 줄. `add_header` 를 쓰는 location 마다 다시 include 해야 합니다(아래 참고) |
| `nginx/conf.d/portfolio-hardening.conf` | http 컨텍스트 드롭인 - 버전 은닉, slowloris 타임아웃, rate limit 존, upstream keepalive |
| `issue-cert-domain.sh` | 도메인 인증서 발급(apex+www+서브 7개 SAN) + 도메인 설정 활성화 |
| `apply-hardening.sh` | 위 드롭인·스니펫·사이트 설정 배치 + 검증 + 실패 시 자동 원복 |
| `nginx/snippets/tls-ip.conf` | 다섯 블록이 공유하는 TLS 설정 - **인증서 경로가 여기 한 곳에만** 있습니다 |
| `nginx/snippets/proxy-app.conf` | 앱 프록시 공통 헤더 |
| `systemd/portfolio-chat.service` | Next standalone `node apps/chat/server.js` (127.0.0.1:3000) |
| `systemd/portfolio-docqa.service` | Next standalone `node apps/docqa/server.js` (127.0.0.1:3030) |
| `systemd/portfolio-exchange.service` | Next standalone `node server.js` (127.0.0.1:3010, 단독 프로젝트라 경로가 다름) |
| `systemd/portfolio-backend.service` | Spring Boot jar(prod, 127.0.0.1:8080), Docker MySQL 의존 |
| `systemd/portfolio-loandoc.service` | FastAPI uvicorn, 릴리스 내 venv (127.0.0.1:8000) |
| `env/*.env.example` | `/etc/portfolio/*.env` 템플릿(시크릿은 서버에서만, 미커밋) |
| `nginx/portfolio-bootstrap.conf` | 발급 전 80 전용 사이트(닭과 달걀 해소 - 아래 참고) |
| `provision.sh` | 새 EC2 최초 1회(패키지·스왑·Docker MySQL·유저·유닛·nginx·인트로 웹루트) |
| `sync-units.sh` | 배포가 올린 systemd 유닛을 `/etc` 로 반영 + `daemon-reload` 하는 루트 헬퍼 |
| `issue-cert-ip.sh` | IP 인증서 발급 + 스니펫에 경로 심기 + 통합 설정 활성화 + 6시간 갱신 타이머 |
| `deploy-remote.sh` | 러너에서 실행: 전송 → 릴리스 교체 → 헬스 게이트 → 롤백 |
| `../.github/workflows/deploy.yml` | 수동(workflow_dispatch) 배포 파이프라인 |

## 라우팅 (IP 리터럴, 도메인 없음)

도메인이 없어 TLS 핸드셰이크에 **SNI 가 없습니다** → 서브도메인을 쓸 수 없습니다.
그리고 앱들이 모두 `/api/*` 를 써서 **경로로도 못 나눕니다**(나누려면 앱마다 basePath 개조가 필요).
그래서 **포트로** 나눕니다. 각 포트의 TLS 블록이 같은 IP 인증서 한 장을 공유합니다.

```
https://<ip>/       인트로 랜딩(정적)              /var/www/intro
https://<ip>:8443/  JC Guard   (Spring)           127.0.0.1:8080
https://<ip>:9443/  JC Chat    (Next)             127.0.0.1:3000
https://<ip>:9444/  JC DocuQA  (Next, + /search)  127.0.0.1:3030
https://<ip>:9445/  JC Exchange(Next)             127.0.0.1:3010
https://<ip>:9446/  JC LoanDoc (FastAPI)          127.0.0.1:8000
http://<ip>/        /.well-known/acme-challenge/ 만 서빙, 나머지는 443 으로 301
```

**보안그룹 인바운드: 80, 443, 8443, 9443, 9444, 9445, 9446 (TCP).**

## 라우팅 (도메인이 있을 때) - 포트가 사라진다

도메인이 붙으면 TLS 핸드셰이크에 **SNI 가 실려** 서브도메인으로 가를 수 있습니다. 그래서 위의
포트 분리가 필요 없어지고 전부 **443 한 포트**로 들어옵니다.

```
https://<도메인>/            인트로               /var/www/intro
https://exchange.<도메인>/   거래소               127.0.0.1:3010
https://chat.<도메인>/       챗봇                 127.0.0.1:3000
https://docqa.<도메인>/      문서QA (+ /search)   127.0.0.1:3030
https://file.<도메인>/       파일 확장자 차단     127.0.0.1:8080 "/"
https://ip.<도메인>/         IP 접근 제어         127.0.0.1:8080 "/ip.html"
https://guard.<도메인>/      위 둘의 원래 주소(유지)
https://guard.<도메인>/relay.html  작업 릴레이   127.0.0.1:8080 (새 서브도메인 없이 경로로)
https://loandoc.<도메인>/    대출 서류 분류        127.0.0.1:8000
https://search.<도메인>/     docqa/search 로 301
https://www.<도메인>/        apex 로 301
```

`file.` / `ip.` 는 **한 Spring 앱의 두 화면**을 각각 승격한 것입니다. 이 앱은 서버 렌더라
클라이언트 라우터가 없어서 "주소는 `/` 인데 내용은 `/ip.html`" 매핑이 안전합니다 - 정적 자산과
API 는 절대경로라 그대로 통과합니다. 반면 `search.` 는 **리다이렉트**입니다: DocuQA 는 Next
App Router 라 같은 수법을 쓰면 라우터 상태와 주소창이 어긋나, 앱 안의 링크를 누르는 순간
엉뚱한 페이지가 그려집니다(겉보기엔 되는데 클릭 한 번에 깨지는 종류라 택하지 않았습니다).

**두 설정을 동시에 켭니다**(`portfolio` + `portfolio-domain`). 대체가 아니라 추가입니다:
SNI 가 있는 요청은 도메인 블록이, 없는 요청(IP 리터럴 접속)은 기존 `default_server` 가 받습니다.
덕분에 전환 중 다운타임이 없고, 도메인이 만료돼도 IP 주소로는 계속 열립니다. 인트로의 링크
조립 스크립트도 호스트가 IP 면 포트를, 도메인이면 서브도메인을 만들어 양쪽 모두에서 맞습니다.

인증서도 두 장이 공존합니다 - IP 인증서(6일, `tls-ip.conf`)와 도메인 인증서(90일, `tls-domain.conf`).
서버 블록마다 자기 인증서를 지정하므로 서로 간섭하지 않습니다.

> ⚠ **nginx `add_header` 상속 함정**: nginx 는 현재 레벨에 `add_header` 가 **하나라도 있으면 상위
> 레벨의 `add_header` 를 통째로 버립니다**(누적이 아닙니다). 그래서 `Cache-Control` 을 붙이는
> location(인트로 `/index.html`, 각 앱 `/_next/static/`)에서는 server 레벨 HSTS 가 조용히 사라집니다.
> `snippets/hsts.conf` 를 그 location 마다 다시 include 하는 이유입니다.

### 도메인 붙이기 (최초 1회)

```bash
# 1) DNS: A 레코드 아홉 개를 서버 공인 IP 로
#    (apex, www, exchange, chat, docqa, search, guard, file, ip, loandoc - 인증서 SAN 과 같은 목록)
cd ~/portfolio && git pull

# 2) 엣지 설정 먼저. 도메인 설정은 upstream **이름**으로 프록시하고 그 정의는 하드닝 드롭인에
#    있다 - 앱이 늘어 upstream 이 추가된 뒤라면 이걸 건너뛸 때 6) 검증이 깨진다.
sudo bash infra/apply-hardening.sh

# 3) 발급 + 활성화 (선행 조건 검사 -> DNS 전파 -> 80 도달 -> dry-run -> 발급 -> 검증)
sudo -E DOMAIN=example.dev LE_EMAIL=you@example.com bash infra/issue-cert-domain.sh
```

> 순서를 지키지 않으면 `host not found in upstream` 으로 nginx 검증이 실패합니다. 스크립트가
> **발급 전에** 이를 잡아 안내하지만(인증서 rate limit 보호), 순서 자체는 위가 정답입니다.

### 엣지 하드닝 (apply-hardening.sh)

```bash
cd ~/portfolio && git pull
sudo bash infra/apply-hardening.sh          # 도메인 사이트는 현재 설정에서 도메인을 읽어 함께 갱신
```

| 항목 | 내용 | 왜 |
|---|---|---|
| `server_tokens off` | 응답 헤더/에러 페이지에서 nginx 버전 제거 | 공짜로 줄 정보가 아니다 |
| slowloris 타임아웃 | header 15s / body 30s / send 30s | 기본값 60초는 "느리게 흘리며 워커 붙잡기"에 관대하다 |
| `limit_req` | `/api/*` 10r/s(burst 20), 업로드 1r/s(burst 10) | 무인증 공개 데모라 인증이 막아 줄 것이 없다 |
| `limit_conn` | IP 당 40 연결 | SSE 가 오래 열려 있어 연결 고갈이 실재한다 |
| XFF 위조 무효화 | `$proxy_add_x_forwarded_for` → `$remote_addr` | 아래 참고 |
| 닷파일 차단 | 인트로(정적) 블록만 `location ~ /\.` | 파일시스템을 직접 서빙하는 유일한 블록 |
| upstream keepalive | 앱마다 `keepalive 32` + `Connection ""` | 요청마다 TCP 신설을 없앤다 |
| 운영 도구 차단 | `/actuator` `/swagger-ui` `/v3/api-docs` `/h2-console` deny | 앱단 제한과 **이중**. 설정 한 줄로 열리는 표면이다 |
| systemd 하드닝 | 네 유닛 동일 세트(아래) | 백엔드 유닛만 빠져 있었다 |

**rate limit 값의 기준**은 "사람은 절대 걸리지 않고 자동화만 걸린다" 입니다. 평가자가 빠르게
클릭하는 것은 정상 사용이고, 그 사람에게 429 를 보여주는 순간 포트폴리오로서는 실패입니다.
그래서 사람의 상한보다 한참 위, 남용의 하한보다 아래에 선을 그었습니다.

> **XFF 를 왜 덮어쓰나**: 기본형 `$proxy_add_x_forwarded_for` 는 *클라이언트가 보낸 XFF* 뒤에
> 실제 IP 를 이어 붙입니다. 이 서버는 엣지라 앞단에 신뢰할 프록시가 없으므로 클라이언트가 보낸
> 값은 전부 위조 후보입니다. 그대로 넘기면 Spring 의 forward-headers 처리가 목록 앞쪽을 실제
> 클라이언트로 신뢰해, `whoami` 와 감사로그의 actor IP 를 요청자가 마음대로 정할 수 있습니다.
> 하필 IP 접근제어 데모라 더 뼈아픕니다. `$remote_addr` 로 덮으면 위조분이 통째로 버려집니다.

### systemd 하드닝

네 유닛 모두 같은 세트입니다(`NoNewPrivileges` · `PrivateTmp` · `ProtectSystem=strict` ·
`ProtectHome` · `ReadWritePaths` · `RestrictSUIDSGID` · `ProtectKernelTunables` ·
`ProtectControlGroups` · `LockPersonality`, 백엔드는 `RestrictAddressFamilies` 추가).

백엔드에 `PrivateTmp` 를 켜면 **격리 파일 적재 문제도 함께 사라집니다**. `quarantine-dir` 이
비어 있으면 앱은 `{java.io.tmpdir}/quarantine` 을 쓰는데(application.yml), 그게 이 서비스만의
사설 `/tmp` 안으로 들어갑니다. 다른 프로세스가 격리 파일을 들여다볼 수 없고, 재시작 때
systemd 가 통째로 비웁니다. 데모라 격리본의 영속이 필요 없으므로 별도 정리 타이머를 두는 것보다
이쪽이 단순합니다.

유닛은 배포가 자동 반영합니다(`sync-units.sh`). 기동에 실패하면 헬스 게이트가 잡아 직전
릴리스로 롤백하지만, **유닛 자체는 되돌아가지 않습니다** - 하드닝을 더 조일 때는 배포 후
`systemctl is-active portfolio-*` 를 반드시 확인하세요.

**아직 하지 않은 것**(판단 근거를 남깁니다):
- **브로틀리 정적 사전압축** - 빌드 파이프라인 4곳을 고쳐야 하는데 이 트래픽에서 이득이 작습니다.
- **HTTP/3(QUIC)** - nginx 재빌드가 필요하고, 단일 리전 저트래픽에서 체감이 marginal 한 수준입니다.
- **fail2ban** - 저장소가 아니라 서버 ops 영역이고, 이미 `limit_req`/`limit_conn` 으로 같은
  공격면을 막습니다. 로그 기반 밴은 그 위의 한 겹이지 대체가 아닙니다.
- **CDN·다중 upstream·mTLS** - 단일 리전 저트래픽이고, 무인증 공개가 의도한 설계라 해당하지 않습니다.

### 데모 표본 복구 (portfolio-demo-reseed.timer)

파일 차단과 IP 접근 제어 두 화면은 **쓰기 API 가 무인증**입니다. 평가자가 직접 눌러 봐야
의미가 있는 데모라 그렇게 열어 두었지만, 되돌릴 길이 없으면 상태가 한 방향으로만 나빠집니다.
누군가 규칙을 전부 지우면 그 다음 방문자는 빈 화면을 봅니다.

한 시간마다 [`demo-reseed.sql`](demo-reseed.sql) 이 **없어진 표본만** 되살립니다. 초기화가
아닙니다 - 방문자가 만든 행을 즉시 지우면 지금 화면을 보고 있는 사람의 작업이 눈앞에서
사라지므로, 방문자 데이터는 24시간이 지난 뒤에 치웁니다. 감사 로그는 append-only 가 요점이라
내용은 손대지 않고 보존 기간(30일)만 둡니다.

표본 IP 는 RFC 5737 / RFC 3849 의 **문서화 전용 대역**을 씁니다. 실존 호스트를 가리키지
않으면서 IPv4 / CIDR / IPv6 세 표기를 한 화면에 보여 줍니다.

이 유닛만 배포가 아니라 **root 가 직접 설치**합니다. `sync-units.sh` 는 `User=deploy` 가 없는
유닛을 거부하는데, 그 방어가 맞습니다 - 배포 계정이 쓸 수 있는 디렉터리에서 root 유닛을 읽어
오면 배포 계정 탈취가 곧 root 가 됩니다. 뚫는 대신 경로를 나눴습니다.

```bash
sudo install -d -o root -g root /opt/portfolio/infra
sudo install -m 0755 -o root -g root infra/demo-reseed.sh  /opt/portfolio/infra/
sudo install -m 0644 -o root -g root infra/demo-reseed.sql /opt/portfolio/infra/
sudo install -m 0644 -o root -g root infra/systemd/portfolio-demo-reseed.service /etc/systemd/system/
sudo install -m 0644 -o root -g root infra/systemd/portfolio-demo-reseed.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now portfolio-demo-reseed.timer
sudo systemctl start portfolio-demo-reseed          # 지금 한 번 실행
journalctl -u portfolio-demo-reseed -n 20 --no-pager
```

데모의 "포트폴리오로 돌아가기" 링크는 **런타임에 지금 호스트에서 조립**합니다. 서브도메인
배포면 첫 라벨을 떼고(`ip.example.dev` -> `example.dev`), IP 배포면 포트를 뗍니다. 빌드 타임
상수로 두었더니 도메인을 붙인 뒤 세 앱이 전부 옛 IP 를 가리켰고, 도메인이 만료되면 이번엔
IP 로 들어온 방문자에게 죽은 주소를 내미는 문제가 남았습니다. 서버 렌더링 시점에만 리포지토리
변수 `PUBLIC_HOST` 가 폴백으로 쓰입니다(스크립트가 꺼져 있어도 링크는 살아 있게).

인트로의 데모 링크에는 IP 가 박혀 있지 않습니다. 인트로가 데모들과 같은 호스트에 있으므로
"지금 페이지의 호스트 + 데모별 포트"로 링크를 조립합니다 - **서버 IP 가 바뀌어도 고칠 곳이 없습니다.**

## 서버 스펙 - t4g.small(2 vCPU / 2GB / arm64) 기준

한 대에 **Node 3 + JVM 1 + MySQL 1 + nginx** 가 함께 삽니다. 가장 빡빡한 자원은 메모리입니다.

| 프로세스 | 조정 후 RSS(대략) | 어떻게 |
|---|---|---|
| Next × 3 | 각 70~110MB | `NODE_OPTIONS=--max-old-space-size=192` (유닛) |
| Spring Boot | **289MB**(t4g.small 실측) | `-Xmx320m -XX:MaxMetaspaceSize=256m -XX:+UseSerialGC` |
| MySQL 8 | 250~300MB | `--innodb-buffer-pool-size=96M --performance-schema=OFF` + 컨테이너 `--memory=640m` |
| nginx + OS | ~200MB | |
| **합계(유휴)** | **850MB 실측**(MySQL+JVM+nginx+OS) | Next 3개 추가 시 약 1.15GB, 여유 0.7GB |

> JVM 을 더 조이지 않는 이유(실측): 메타스페이스를 96m 로 잡았더니 Hibernate 클래스 로딩 중
> `OutOfMemoryError: Metaspace` 로 **기동 자체가 실패**했습니다. Spring Boot + Hibernate + Tika 는
> 클래스가 많아 150~250MB 로 수렴합니다(상한을 256m 로 준 뒤 실측 RSS 는 289MB - 상한은 안전망일 뿐
> 실제로 그만큼 쓰지 않습니다). `-Xss512k` 로 스레드 스택까지 줄이는 것도 위험합니다.
> 아낀 메모리는 수 MB 인데 서비스가 안 뜨는 거래라 되돌렸습니다. 헬스 게이트도 JVM(180초)과
> Node(60초)를 따로 잡습니다 - 같은 값으로 재면 정상 기동을 실패로 판정합니다.

**2GB 로 가능한 전제 세 가지**(하나라도 어기면 t4g.medium 으로 올려야 합니다):

1. **서버에서 빌드하지 않습니다.** Next 빌드 한 번이 1~2GB 를 씁니다. 빌드는 GitHub Actions 에서 하고
   서버는 산출물만 받습니다(현 파이프라인 그대로).
2. **스왑 2GB + `vm.swappiness=10`.** 재배포처럼 순간적으로 메모리가 겹칠 때 OOM 킬러가 아무 프로세스나
   죽이는 대신 잠깐 느려지고 넘어가게 하는 보험입니다(비용 0).
3. **위 표의 메모리 상한들이 실제로 걸려 있어야 합니다.** `provision.sh` 와 systemd 유닛에 들어 있습니다.

### 증상별 판단 - medium 으로 올려야 할 때

```bash
free -m                      # available 이 200MB 아래로 상시 내려가면 위험
vmstat 1 5                   # si/so(스왑 입출력)가 0 이 아니고 계속 움직이면 상시 스왑 = 느려짐
journalctl -k | grep -i oom  # OOM 킬 흔적이 있으면 즉시 상향
```

올릴 때는 **인스턴스 타입만 t4g.medium 으로 변경**하면 됩니다(EBS 유지, 정지 → 타입 변경 → 시작).
설정은 그대로 둬도 되고, 여유가 생기면 JVM `-Xmx512m` / MySQL buffer pool `256M` 로 되돌리면 됩니다.

### arm64 주의 - 빌드 아키텍처를 서버와 맞춥니다

t4g 는 Graviton(arm64)입니다. Next 의 standalone 산출물에는 `sharp` 의 **플랫폼 전용 네이티브
바이너리**가 트레이싱돼 함께 실립니다. x64 러너에서 빌드해 arm64 서버에 올리면 못 쓰는 바이너리가
올라가고, 이미지 최적화 경로에서만 터져 원인을 찾기 어렵습니다. 그래서 배포 워크플로의 빌드 잡은
**`ubuntu-24.04-arm`** 에서 돕니다. Spring jar 는 JVM 바이트코드라 아키텍처 무관이고, MySQL 8 공식
이미지는 arm64 를 지원합니다(JDK 는 apt 가 아키텍처에 맞게 설치).

## 배포 레이아웃 (원자 교체 + 롤백)

```
/opt/portfolio/{chat,docqa,exchange,backend,loandoc}/
├── releases/<timestamp>/   # 각 배포가 새 디렉터리로 들어온다(최근 3개 유지)
└── current -> releases/<timestamp>   # 심링크만 바꿔 원자 교체. 헬스 실패 시 직전으로 되돌린다

/var/www/intro/             # 인트로는 정적이라 릴리스/재기동이 없다(rsync --delete 로 동기화)
```

## 최초 1회

```bash
sudo bash infra/provision.sh
# 1) 보안그룹 인바운드: 80, 443, 8443, 9443-9446
# 2) /etc/portfolio/backend.env 에 실제 DB 값(+ MySQL 컨테이너 비번 동기화)
# 3) IP 인증서 발급 + 통합 설정 활성화(한 방에)
sudo -E LE_EMAIL=you@example.com bash infra/issue-cert-ip.sh
# 4) systemctl enable --now portfolio-chat portfolio-docqa portfolio-exchange portfolio-backend portfolio-loandoc
```

### 발급 전에는 왜 80 만 띄우나 (닭과 달걀)

`portfolio.conf` 의 TLS 블록은 아직 없는 인증서 파일을 가리킵니다 → `nginx -t` 실패 → nginx 가 뜨지
않음 → 80포트의 ACME 경로도 안 뜸 → **발급 자체가 불가능**. 그래서 `provision.sh` 는 80 전용
`portfolio-bootstrap` 만 켜 두고, `issue-cert-ip.sh` 가 발급을 마친 뒤 본 설정으로 교체합니다.
교체가 실패하면 자동으로 부트스트랩으로 롤백해 **갱신 경로는 항상 살아 있습니다.**

기존 `portfolio_jquery_spring/scripts/setup-tls-ip.sh` 는 단일 앱 서버 전용(자기 nginx 사이트를 직접
써 내려감)이라 이 구성에서는 443 default_server 가 충돌합니다. 그래서 **발급만 하는** 스크립트를
따로 두었습니다.

> ⚠ **생명선**: 80포트의 `location ^~ /.well-known/acme-challenge/` 블록은 절대 덮거나 리다이렉트
> 뒤로 밀지 마세요. IP 인증서는 6일 주기 http-01 갱신이라, 이 경로가 막히면 갱신이 실패하고
> 만료 시 **여섯 데모가 동시에** 내려갑니다.

## 배포 (GitHub Actions)

`Actions -> deploy -> Run workflow`(수동). `push` 로는 절대 자동 실행되지 않습니다.
`target` 으로 전체(`all`) 또는 개별 앱(`intro`/`chat`/`docqa`/`exchange`/`backend`)을 고릅니다.

필요 시크릿(리포지토리):
- `DEPLOY_HOST` - EC2 공인 IP
- `DEPLOY_USER` - 배포 사용자(예: `deploy`)
- `DEPLOY_SSH_KEY` - 그 사용자의 개인키

파이프라인은 백엔드 jar / Next standalone 3벌 / 인트로 정적 파일을 만들어 서버로 rsync 하고,
`current` 심링크를 새 릴리스로 바꾼 뒤 재기동합니다. 이어 각 앱의 헬스 게이트
(`/actuator/health` · 각 Next 루트)를 돌려, 실패하면 **직전 릴리스로 롤백**합니다.

데모 안의 "포트폴리오로 돌아가기" 링크는 인트로(443)를 가리켜야 하는데, 호스트가 시크릿이라
빌드 산출물에는 자리표시자로 넣고 **배포 직전에 치환**합니다(빌드 로그에 IP 를 남기지 않습니다).

배포 사용자는 `systemctl restart portfolio-*` 를 무암호 sudo 로 실행할 수 있어야 합니다.
**앱을 추가하면 이 목록도 함께 늘려야 합니다** - 빠뜨리면 그 앱의 재기동만 조용히 비밀번호를
물어보다 실패합니다(loandoc 첫 배포가 그랬습니다). `/etc/sudoers.d/portfolio`:

```
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart portfolio-chat, /usr/bin/systemctl restart portfolio-docqa, /usr/bin/systemctl restart portfolio-exchange, /usr/bin/systemctl restart portfolio-backend, /usr/bin/systemctl restart portfolio-loandoc, /usr/bin/systemctl reset-failed portfolio-chat, /usr/bin/systemctl reset-failed portfolio-docqa, /usr/bin/systemctl reset-failed portfolio-exchange, /usr/bin/systemctl reset-failed portfolio-backend, /usr/bin/systemctl reset-failed portfolio-loandoc, /usr/local/sbin/portfolio-sync-units
```

### 유닛 파일도 배포가 반영합니다

유닛(예: JVM 플래그)을 고쳐도 서버 `/etc/systemd/system` 은 그대로라, 예전에는 사람이 SSH 로
들어가 `cp` + `daemon-reload` 를 해야 했습니다. 지금은 배포가 `infra/systemd/` 를
`/opt/portfolio/units/` 로 올린 뒤 루트 헬퍼(`portfolio-sync-units`)를 불러 반영합니다.

헬퍼는 **인자를 받지 않습니다**. 경로를 인자로 받으면 배포 계정이 root 로 아무 파일이나
덮어쓰는 통로가 되기 때문입니다. 또 `User=deploy` 가 없는 유닛은 거부해, root 로 도는 서비스를
심어 권한을 올리는 뻔한 경로를 막습니다. 그래도 "배포 계정이 유닛 내용을 정한다"는 성질은 남으므로
이는 **의식적인 트레이드오프**입니다(운영자 1명, 개인 데모 서버 기준).

거부는 **전부 아니면 전무**입니다 - 유닛 하나가 걸리면 그 배포의 유닛 반영이 통째로 멈춥니다.
그래서 배포는 root 유닛(`portfolio-demo-reseed.*`)을 애초에 이 디렉터리로 올리지 않습니다.
예전에는 올렸고, 그 때문에 반영이 매번 거부되고 있었는데 **기존 유닛이 이미 설치돼 있어
아무도 눈치채지 못했습니다**. 새 유닛(loandoc)이 처음 필요해진 배포에서 "unit could not be
found" 로 드러났습니다.

헬퍼가 설치돼 있지 않은 서버에서는 이 단계를 조용히 건너뜁니다 - 배포 전체를 실패시키지 않습니다.
기존 서버에 1회만 설치하면 됩니다:

```bash
cd ~/portfolio && git pull
sudo install -m 0755 -o root -g root infra/sync-units.sh /usr/local/sbin/portfolio-sync-units
sudo mkdir -p /opt/portfolio/units && sudo chown deploy:deploy /opt/portfolio/units
# 그리고 위 sudoers 한 줄을 /etc/sudoers.d/portfolio 에 갱신
```
`reset-failed` 가 필요한 이유: 크래시 루프로 재시작 한도에 걸린 유닛은 `restart` 를 거부합니다.
그 상태에서는 원인을 고쳐 배포해도 뜨지 않으므로, 배포가 스스로 그 상태를 풀 수 있어야 합니다.

### 산출물 복사는 `cp -a` (pnpm 심링크)

pnpm 의 `node_modules` 는 `.pnpm` 저장소를 가리키는 심링크 구조입니다. GNU `cp -r` 은 심링크를
**따라가 실체를 복사**하므로(BSD 와 다름) 그 구조가 뭉개지고, 서버에서
`Cannot find module 'styled-jsx'` 같은 형태로만 드러납니다. 워크플로는 `cp -a` 로 심링크를 보존하고,
복사 직후 `next/package.json` 해석과 `require-hook` 로드를 확인해 **빌드 단계에서** 실패시킵니다.
