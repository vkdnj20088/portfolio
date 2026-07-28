#!/usr/bin/env bash
#
# 베어 IP 에 Let's Encrypt 단수명(160시간 ≈ 6일) 인증서를 발급하고, 통합 nginx 설정
# (infra/nginx/portfolio.conf)을 활성화한다. 새 EC2 에서 provision.sh 다음에 한 번 실행한다.
#
#   sudo -E bash infra/issue-cert-ip.sh            # IP 자동 감지(IMDSv2)
#   sudo IP=13.125.0.1 bash infra/issue-cert-ip.sh # 명시 지정
#   export LE_EMAIL=you@example.com                # 만료 알림 수신(선택)
#
# 기존 portfolio_jquery_spring/scripts/setup-tls-ip.sh 와의 차이:
#  - 그 스크립트는 "단일 앱 서버" 전용이라 자기 nginx 사이트(8080 프록시)를 직접 써 내려간다.
#    다섯 데모를 포트로 나누는 지금 구성에서는 443 default_server 가 충돌한다.
#  - 그래서 여기서는 **발급만** 하고, nginx 는 버전관리된 portfolio.conf 를 켜는 것으로 끝낸다.
#    인증서 경로는 스니펫 한 곳(portfolio-tls-ip.conf)에만 심는다.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")" && pwd)"
WEBROOT="/var/www/acme"
TLS_SNIPPET="/etc/nginx/snippets/portfolio-tls-ip.conf"
SITE_FULL="/etc/nginx/sites-available/portfolio"
SITE_BOOT="/etc/nginx/sites-available/portfolio-bootstrap"
ENABLED_DIR="/etc/nginx/sites-enabled"
STAMP="$(date +%Y%m%d-%H%M%S)"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[실패] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요(sudo)."

# ── 0) 대상 IP 확정 ─────────────────────────────────────────
if [[ -z "${IP:-}" ]]; then
  # IMDSv2(토큰 필수). 여기서 얻는 것은 인스턴스에 연결된 공인 IP = 인증서 대상.
  TOKEN="$(curl -fsS -X PUT 'http://169.254.169.254/latest/api/token' \
            -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
  IP="$(curl -fsS -H "X-aws-ec2-metadata-token: ${TOKEN}" \
        'http://169.254.169.254/latest/meta-data/public-ipv4' 2>/dev/null || true)"
fi
[[ -n "${IP:-}" ]] || die "공인 IP 를 알 수 없습니다. IP=<주소> 로 지정하세요."
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "IPv4 형식이 아닙니다: $IP"
LIVE="/etc/letsencrypt/live/${IP}"
RENEWAL_CONF="/etc/letsencrypt/renewal/${IP}.conf"
log "대상 IP: ${IP}"
warn "이 IP 가 탄력적 IP(EIP)인지 확인하세요. 인스턴스 재시작으로 IP 가 바뀌면 인증서가 무효가 됩니다."

# ── 1) certbot 5.4+ (apt 판 2.x 는 --ip-address 미지원) ─────
log "1) certbot 준비"
need_install=1
if command -v certbot >/dev/null 2>&1; then
  ver="$(certbot --version 2>&1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo 0)"
  [[ "${ver%%.*}" -ge 5 ]] && { need_install=0; echo "certbot ${ver} — 사용 가능"; }
fi
if [[ $need_install -eq 1 ]]; then
  apt-get remove -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
  snap install core >/dev/null 2>&1 || true
  snap refresh core >/dev/null 2>&1 || true
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi
certbot --version 2>&1 | grep -qE 'certbot ([5-9]|[1-9][0-9])\.' \
  || die "certbot 5.x 이상이 필요합니다(--ip-address 지원)."

# ── 1.5) 저장소의 nginx 파일을 /etc 로 다시 배치 ────────────
# provision.sh 가 한 번 복사한 뒤 저장소 쪽 설정을 고쳐도 /etc 에는 반영되지 않는다.
# 이 스크립트가 "활성화"만 하고 복사를 안 하면, 고친 설정 대신 옛 파일이 켜져 원인을 찾기 어렵다.
# 그래서 매 실행마다 저장소를 진실원으로 삼아 덮어쓴다(인증서 경로는 아래 5)에서 다시 심는다).
log "1.5) 저장소의 nginx 설정 배치(진실원 = 저장소)"
if [[ -f "$INFRA/nginx/portfolio.conf" ]]; then
  install -d /etc/nginx/snippets
  cp "$INFRA/nginx/portfolio.conf"           "$SITE_FULL"
  cp "$INFRA/nginx/portfolio-bootstrap.conf" "$SITE_BOOT"
  cp "$INFRA/nginx/snippets/tls-ip.conf"     "$TLS_SNIPPET"
  cp "$INFRA/nginx/snippets/proxy-app.conf"  /etc/nginx/snippets/portfolio-proxy-app.conf
  echo "배치 완료: $(basename "$SITE_FULL"), $(basename "$SITE_BOOT"), snippets 2개"
else
  warn "저장소의 nginx 파일을 찾지 못했습니다($INFRA). /etc 의 기존 파일을 그대로 씁니다."
fi

# ── 2) 부트스트랩(80 전용) 사이트로 ACME 경로 확보 ──────────
# 본 설정은 아직 없는 인증서를 가리켜 nginx -t 가 실패한다. 발급 전에는 80 만 띄운다.
log "2) ACME 경로 서빙 확인"
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
chown -R www-data:www-data "${WEBROOT}" 2>/dev/null || true
echo "acme-ok" > "${WEBROOT}/.well-known/acme-challenge/ping"

rm -f "${ENABLED_DIR}/portfolio" "${ENABLED_DIR}/default"
ln -sfn "${SITE_BOOT}" "${ENABLED_DIR}/portfolio-bootstrap"
nginx -t || die "부트스트랩 nginx 설정 오류"
systemctl reload nginx || systemctl start nginx

for i in $(seq 1 10); do
  body="$(curl -fsS --max-time 3 'http://127.0.0.1/.well-known/acme-challenge/ping' 2>/dev/null || true)"
  [[ "$body" == "acme-ok" ]] && break
  sleep 1
done
[[ "${body:-}" == "acme-ok" ]] || die "nginx 가 ACME 경로를 서빙하지 않습니다."
echo "로컬 확인 OK (외부 도달은 다음 단계의 --dry-run 이 실제로 검증한다)"

# ── 3) 발급 리허설 -> 실발급 ────────────────────────────────
EMAIL_ARGS=(--register-unsafely-without-email)
[[ -n "${LE_EMAIL:-}" ]] && EMAIL_ARGS=(-m "${LE_EMAIL}" --no-eff-email)

log "3) 발급 리허설(--dry-run: rate limit 소모 없음)"
certbot certonly --dry-run --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
  --preferred-profile shortlived --webroot -w "${WEBROOT}" --ip-address "${IP}" \
  || die "리허설 실패 — 80 포트가 외부에서 닿는지(보안그룹) 먼저 확인하세요."

log "4) 실제 발급(160시간 ≈ 6일)"
certbot certonly --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
  --preferred-profile shortlived --webroot -w "${WEBROOT}" --ip-address "${IP}" \
  --deploy-hook "systemctl reload nginx" \
  || die "발급 실패"
[[ -f "${LIVE}/fullchain.pem" ]] || die "인증서 파일이 없습니다: ${LIVE}"

# ── 5) 인증서 경로를 스니펫 한 곳에 심고 본 설정 활성화 ─────
log "5) nginx 통합 설정 활성화(포트 분리 5블록)"
[[ -f "$TLS_SNIPPET" ]] || die "스니펫이 없습니다: ${TLS_SNIPPET} (provision.sh 를 먼저 실행)"
cp -a "$TLS_SNIPPET" "${TLS_SNIPPET}.bak.${STAMP}"
sed -i "s|/etc/letsencrypt/live/[^/]*/|/etc/letsencrypt/live/${IP}/|g" "$TLS_SNIPPET"
grep -q "${IP}" "$TLS_SNIPPET" || die "스니펫 치환 실패 — CERT_DIR 자리를 확인하세요."

rm -f "${ENABLED_DIR}/portfolio-bootstrap"
ln -sfn "${SITE_FULL}" "${ENABLED_DIR}/portfolio"
if ! nginx -t; then
  warn "본 설정 오류 → 부트스트랩(80 전용)으로 롤백"
  rm -f "${ENABLED_DIR}/portfolio"
  ln -sfn "${SITE_BOOT}" "${ENABLED_DIR}/portfolio-bootstrap"
  nginx -t && systemctl reload nginx
  die "nginx 통합 설정 실패 — 80 포트만 살아 있습니다(ACME 갱신은 유지)."
fi
systemctl reload nginx

# ── 6) 자동 갱신(6일짜리라 갱신이 곧 가용성) ────────────────
log "6) 자동 갱신 구성"
if [[ -f "$RENEWAL_CONF" ]]; then
  sed -i '/^renew_before_expiry/d' "$RENEWAL_CONF"
  sed -i '1i renew_before_expiry = 2 days' "$RENEWAL_CONF"
fi
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
certbot renew --dry-run || warn "갱신 리허설 실패 — 6일 뒤 만료 위험! 원인을 반드시 해결하세요."

# ── 7) 검증 ─────────────────────────────────────────────────
log "7) 검증(서버 내부)"
echo "--- 인증서 주체/유효기간 ---"
{ echo | openssl s_client -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates; } \
  || warn "인증서 조회 실패"
echo "--- 포트별 응답(앱이 아직 안 떠 있으면 502 가 정상) ---"
for p in 443 8443 9443 9444 9445; do
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://127.0.0.1:${p}/" || echo '---')"
  printf '  %-5s -> %s\n' "$p" "$code"
done

cat <<EOF

$(printf '\033[1;32m완료\033[0m')  →  https://${IP}/  (인트로)
  :8443 Guard · :9443 Chat · :9444 DocuQA · :9445 Exchange

[중요] 160시간(약 6일) 인증서입니다. 자동 갱신이 곧 가용성입니다.
  · 갱신 확인:   sudo certbot renew --dry-run
  · 만료 확인:   echo | openssl s_client -connect ${IP}:443 2>/dev/null | openssl x509 -noout -dates
  · 80 포트의 ACME 경로를 막는 설정을 절대 넣지 마세요.

[다음] GitHub Secrets(DEPLOY_HOST=${IP}, DEPLOY_USER, DEPLOY_SSH_KEY) 설정 후
       Actions -> deploy -> target=all 실행.
EOF
