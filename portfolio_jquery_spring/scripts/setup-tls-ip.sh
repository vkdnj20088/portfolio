#!/usr/bin/env bash
#
# 베어 IP(https://52.79.154.220)에 Let's Encrypt 단수명(160시간 ≈ 6일) 인증서를 발급하고
# nginx 에 연결한 뒤, 자동 갱신을 구성한다. EC2(Ubuntu) 서버에서 실행.
#
#   사용법:  export LE_EMAIL=you@example.com   # 만료 알림 수신용(선택)
#            sudo -E bash scripts/setup-tls-ip.sh
#
# 배경(왜 이렇게 하는가):
#  - Let's Encrypt 는 2026-01-15 부터 IP 주소 인증서를 정식 발급한다. 단 IP 는 도메인보다
#    유동적이라(EIP 반납 시 타인에게 재할당) 반드시 'shortlived' 프로필 = 160시간 강제.
#  - IP 식별자는 dns-01 챌린지를 쓸 수 없다(IP엔 TXT 레코드를 걸 DNS가 없음). http-01 사용.
#  - certbot 은 IP 인증서를 "발급"만 하고 nginx "설치"는 못 한다 → 아래에서 직접 구성.
#  - HSTS 는 넣지 않는다. 브라우저는 IP 리터럴 호스트에 HSTS 를 적용하지 않으므로 무의미.
#  - OCSP stapling 도 넣지 않는다. 단수명 인증서는 폐기(revocation) 정보를 갖지 않는다.
#
set -euo pipefail

IP="52.79.154.220"
# 통합 서버 infra/nginx/portfolio.conf 및 infra/provision.sh 와 동일한 ACME 웹루트.
# 불일치하면 http-01 챌린지가 404 -> 발급/갱신 실패(생명선). 반드시 같은 경로를 쓴다.
WEBROOT="/var/www/acme"
SITE_AVAIL="/etc/nginx/sites-available/extension-block"
SITE_ENABLED="/etc/nginx/sites-enabled/extension-block"
LIVE="/etc/letsencrypt/live/${IP}"
RENEWAL_CONF="/etc/letsencrypt/renewal/${IP}.conf"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${SITE_AVAIL}.bak.${STAMP}"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# systemctl reload 는 비동기(SIGHUP 후 즉시 리턴)라, 리로드 직후 곧바로 확인하면
# 아직 옛 설정이 응답한다. 새 설정이 실제로 적용될 때까지 재시도한다.
wait_for_url() {  # wait_for_url <url> [시도횟수]
  local url="$1" tries="${2:-15}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

[[ $EUID -eq 0 ]] || die "root 로 실행하세요:  sudo -E bash $0"

# ─────────────────────────────────────────────────────────────
log "0) 사전 점검"
command -v nginx >/dev/null || die "nginx 가 없습니다."
nginx -t || die "현재 nginx 설정이 이미 깨져 있습니다. 먼저 고치세요."
curl -sf -o /dev/null --max-time 5 http://127.0.0.1:8080/actuator/health \
  || warn "앱(127.0.0.1:8080) 헬스체크 실패 — TLS 와 별개지만 확인 필요"
echo "현재 nginx 사이트:"; ls -l /etc/nginx/sites-enabled/ || true

# ─────────────────────────────────────────────────────────────
log "1) certbot 5.4+ 설치 (apt 판 2.x 는 --ip-address 미지원)"
need_install=1
if command -v certbot >/dev/null 2>&1; then
  ver="$(certbot --version 2>&1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo 0)"
  major="${ver%%.*}"
  if [[ "${major:-0}" -ge 5 ]]; then need_install=0; echo "certbot ${ver} — 사용 가능"; fi
fi
if [[ $need_install -eq 1 ]]; then
  apt-get remove -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
  snap install core >/dev/null 2>&1 || true
  snap refresh core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi
certbot --version
certbot --version 2>&1 | grep -qE 'certbot ([5-9]|[1-9][0-9])\.' \
  || die "certbot 5.x 이상이 필요합니다(--ip-address 지원). 설치 실패."

# ─────────────────────────────────────────────────────────────
log "2) ACME 챌린지 웹루트 준비"
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
chown -R www-data:www-data "${WEBROOT}" 2>/dev/null || true
echo "acme-ok" > "${WEBROOT}/.well-known/acme-challenge/ping"

# ─────────────────────────────────────────────────────────────
log "3) nginx: 80 번에 ACME 경로 서빙 (아직 HTTPS 리다이렉트는 걸지 않는다)"
[[ -f "$SITE_AVAIL" ]] && cp -a "$SITE_AVAIL" "$BACKUP" && echo "백업: $BACKUP"

# 다른 default_server 와 충돌 방지: 기본 사이트 비활성화
if [[ -e /etc/nginx/sites-enabled/default ]]; then
  mv /etc/nginx/sites-enabled/default "/etc/nginx/sites-enabled.default.disabled.${STAMP}" 2>/dev/null \
    || rm -f /etc/nginx/sites-enabled/default
  echo "기본 사이트(default) 비활성화 — 443 default_server 충돌 방지"
fi

cat > "$SITE_AVAIL" <<'NGINX_HTTP_ONLY'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # ACME 갱신용. 반드시 리다이렉트/프록시보다 위에 둔다 — 이걸 덮으면 갱신이 죽는다.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
        default_type "text/plain";
    }

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_HTTP_ONLY

ln -sf "$SITE_AVAIL" "$SITE_ENABLED"
nginx -t || { warn "설정 오류 → 롤백"; [[ -f "$BACKUP" ]] && cp -a "$BACKUP" "$SITE_AVAIL"; nginx -t && systemctl reload nginx; die "nginx 설정 실패"; }
systemctl reload nginx

# 로컬(127.0.0.1)로 확인한다. 인스턴스가 자기 EIP 로 되돌아 접속(hairpinning)하는 것은
# AWS 에서 실패할 수 있어 오탐이 난다. 외부 도달 여부는 4)의 --dry-run 이 실제로 검증한다.
echo -n "ACME 경로 로컬 서빙 확인(리로드 반영까지 재시도): "
if wait_for_url "http://127.0.0.1/.well-known/acme-challenge/ping"; then
  echo "OK"
else
  die "nginx 가 ACME 경로를 서빙하지 않습니다. 설정 확인 필요."
fi

# ─────────────────────────────────────────────────────────────
log "4) 발급 리허설 (--dry-run: 실제 rate limit 소모 없음)"
EMAIL_ARGS=(--register-unsafely-without-email)
if [[ -n "${LE_EMAIL:-}" ]]; then EMAIL_ARGS=(-m "${LE_EMAIL}" --no-eff-email); fi

certbot certonly --dry-run --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
  --preferred-profile shortlived \
  --webroot -w "${WEBROOT}" \
  --ip-address "${IP}" \
  || die "리허설 실패 — 실발급 중단. 위 오류를 먼저 해결하세요."

log "5) 실제 발급 (160시간 = 약 6일)"
certbot certonly --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
  --preferred-profile shortlived \
  --webroot -w "${WEBROOT}" \
  --ip-address "${IP}" \
  --deploy-hook "systemctl reload nginx" \
  || die "발급 실패"

[[ -f "${LIVE}/fullchain.pem" ]] || die "인증서 파일이 없습니다: ${LIVE}"

# ─────────────────────────────────────────────────────────────
log "6) nginx: 443 서버 블록 + 80 → 443 리다이렉트"
cp -a "$SITE_AVAIL" "${SITE_AVAIL}.http-only.${STAMP}"

# HTTP/2 활성화 문법은 nginx 1.25.1 에서 바뀌었다.
#   < 1.25.1 : listen 443 ssl http2;   (별도 http2 지시자 없음 → "unknown directive")
#   >= 1.25.1: listen 443 ssl;  +  http2 on;
NGINX_VER="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
ver_ge() { printf '%s\n%s\n' "$2" "$1" | sort -V -C; }   # $1 >= $2 이면 참
if ver_ge "${NGINX_VER:-0.0.0}" "1.25.1"; then
  LISTEN_4="listen 443 ssl default_server;"
  LISTEN_6="listen [::]:443 ssl default_server;"
  HTTP2_LINE="http2 on;"
else
  LISTEN_4="listen 443 ssl http2 default_server;"
  LISTEN_6="listen [::]:443 ssl http2 default_server;"
  HTTP2_LINE="# HTTP/2 는 listen 지시자에 포함 (nginx ${NGINX_VER} < 1.25.1)"
fi
echo "nginx ${NGINX_VER} → HTTP/2 문법: ${LISTEN_4}"

cat > "$SITE_AVAIL" <<NGINX_TLS
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # ACME 갱신용. 리다이렉트보다 위 — 이 블록을 덮으면 갱신이 죽고 6일 뒤 사이트가 만료된다.
    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type "text/plain";
    }

    location / { return 301 https://\$host\$request_uri; }
}

server {
    # IP 리터럴 접속은 SNI 를 보내지 않는다 → 이 블록이 default_server 여야 인증서가 선택된다.
    ${LISTEN_4}
    ${LISTEN_6}
    ${HTTP2_LINE}
    server_name _;

    ssl_certificate     ${LIVE}/fullchain.pem;
    ssl_certificate_key ${LIVE}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    # OCSP stapling 없음: 단수명 인증서는 폐기 정보를 갖지 않는다.
    # HSTS 없음: 브라우저는 IP 리터럴 호스트에 HSTS 를 적용하지 않는다.

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_TLS

if ! nginx -t; then
  warn "TLS 설정 오류 → HTTP 전용으로 롤백"
  cp -a "${SITE_AVAIL}.http-only.${STAMP}" "$SITE_AVAIL"
  nginx -t && systemctl reload nginx
  die "nginx TLS 설정 실패 (사이트는 HTTP 로 복구됨)"
fi
systemctl reload nginx

# ─────────────────────────────────────────────────────────────
log "7) 자동 갱신 구성 (6일 인증서 → 만료 2일 전부터 시도)"
if [[ -f "$RENEWAL_CONF" ]]; then
  sed -i '/^renew_before_expiry/d' "$RENEWAL_CONF"
  sed -i '1i renew_before_expiry = 2 days' "$RENEWAL_CONF"
  echo "renew_before_expiry = 2 days  → ${RENEWAL_CONF}"
fi

# certbot snap 타이머는 기본 1일 2회. 6일 인증서라 6시간마다로 조여 실패 여유를 4배 확보.
mkdir -p /etc/systemd/system/snap.certbot.renew.timer.d
cat > /etc/systemd/system/snap.certbot.renew.timer.d/override.conf <<'TIMER'
[Timer]
OnCalendar=
OnCalendar=*-*-* 00/6:00:00
RandomizedDelaySec=15m
Persistent=true
TIMER
systemctl daemon-reload
systemctl restart snap.certbot.renew.timer 2>/dev/null || true

log "8) 갱신 리허설"
certbot renew --dry-run || warn "갱신 리허설 실패 — 6일 뒤 만료 위험! 반드시 원인 해결"

# ─────────────────────────────────────────────────────────────
# 서버 내부에서는 localhost 로 확인한다(자기 EIP 접속은 실패할 수 있음).
# 진짜 확인은 아래 안내대로 "본인 노트북"에서 하세요.
log "9) 서버 내부 검증"
echo "--- 인증서 주체/유효기간 ---"
{ echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null \
    | openssl x509 -noout -subject -dates; } || warn "인증서 조회 실패"
echo "--- 앱 응답(HTTPS, 로컬) ---"
curl -sk --max-time 10 "https://127.0.0.1/actuator/health" || warn "HTTPS 로컬 응답 실패"; echo
echo "--- HTTP → HTTPS 리다이렉트 ---"
{ curl -sI --max-time 5 "http://127.0.0.1/" | head -2; } || true
echo "--- 보안 헤더(CSP) ---"
{ curl -skI --max-time 5 "https://127.0.0.1/" | grep -i content-security-policy; } || warn "CSP 헤더 미확인"
echo "--- 갱신 타이머 ---"
{ systemctl list-timers --all 2>/dev/null | grep -i certbot; } || true

cat <<EOF

$(printf '\033[1;32m완료\033[0m')  →  https://${IP}

[중요] 이 인증서는 160시간(약 6일)짜리입니다. 자동 갱신이 생명입니다.
  · 갱신 상태:   sudo certbot renew --dry-run
  · 만료일 확인: echo | openssl s_client -connect ${IP}:443 2>/dev/null | openssl x509 -noout -dates
  · 면접 전날 반드시 위 만료일을 확인하세요.

[롤백] HTTPS 가 문제되면 HTTP 전용으로 즉시 복구:
  sudo cp -a ${SITE_AVAIL}.http-only.${STAMP} ${SITE_AVAIL} && sudo nginx -t && sudo systemctl reload nginx
EOF
