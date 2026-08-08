#!/usr/bin/env bash
#
# 도메인(apex + 서브도메인 4개 + www)에 Let's Encrypt 표준 90일 인증서를 한 장(SAN)으로 발급하고,
# 서브도메인 기반 nginx 설정(infra/nginx/portfolio-domain.conf)을 활성화한다.
#
#   sudo -E DOMAIN=jongeunchoi.dev bash infra/issue-cert-domain.sh
#   export LE_EMAIL=you@example.com        # 만료 알림 수신(권장 - 90일 주기라 놓치기 쉽다)
#
# IP 인증서(issue-cert-ip.sh)와의 관계: **대체가 아니라 추가**다.
#  - 포트 분리 설정(portfolio.conf)은 그대로 켜 둔 채 도메인 설정을 나란히 켠다.
#  - SNI 가 있는 요청(도메인)은 도메인 블록이, 없는 요청(IP 리터럴)은 기존 default_server 가 받는다.
#  - 따라서 이 스크립트가 실패해도 기존 IP 접속은 멀쩡하다. 되돌릴 곳이 항상 있다.
#
# 발급 전에 DNS 가 이 서버를 가리켜야 한다. http-01 은 Let's Encrypt 가 각 이름으로 직접
# 접속해 오는 방식이라, A 레코드가 안 퍼졌으면 무조건 실패한다. 그래서 아래 2) 에서 먼저 막는다.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")" && pwd)"
WEBROOT="/var/www/acme"
TLS_SNIPPET="/etc/nginx/snippets/portfolio-tls-domain.conf"
HSTS_SNIPPET="/etc/nginx/snippets/portfolio-hsts.conf"
PROXY_SNIPPET="/etc/nginx/snippets/portfolio-proxy-app.conf"
SITE_DOMAIN="/etc/nginx/sites-available/portfolio-domain"
ENABLED_DIR="/etc/nginx/sites-enabled"
STAMP="$(date +%Y%m%d-%H%M%S)"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[실패] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요(sudo)."
[[ -n "${DOMAIN:-}" ]] || die "DOMAIN=<도메인> 을 지정하세요. 예: sudo -E DOMAIN=jongeunchoi.dev bash $0"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || die "도메인 형식이 아닙니다: $DOMAIN"

# 인증서에 담을 이름들. 서브도메인은 nginx 설정(portfolio-domain.conf)과 반드시 같아야 한다.
# file/ip 는 guard 의 두 화면을 각각 승격한 것, search 는 docqa/search 로 보내는 입구다.
# guard/docqa 도 남긴다 - 이미 뿌린 주소가 죽지 않게.
SUBS=(www exchange chat docqa search guard file ip loandoc)
NAMES=("$DOMAIN")
for s in "${SUBS[@]}"; do NAMES+=("${s}.${DOMAIN}"); done

LIVE="/etc/letsencrypt/live/${DOMAIN}"
log "대상: ${NAMES[*]}"

# ── 0) 사전 점검 ────────────────────────────────────────────
log "0) 사전 점검"
[[ -f "$PROXY_SNIPPET" ]] || die "프록시 스니펫이 없습니다: ${PROXY_SNIPPET} (provision.sh 를 먼저 실행)"
[[ -d "$WEBROOT" ]] || die "ACME 웹루트가 없습니다: ${WEBROOT} (provision.sh 를 먼저 실행)"
command -v certbot >/dev/null 2>&1 || die "certbot 이 없습니다. issue-cert-ip.sh 를 먼저 실행했다면 설치돼 있어야 합니다."
command -v dig >/dev/null 2>&1 || apt-get install -y dnsutils >/dev/null 2>&1 || true
# dig 이 없으면 아래 DNS 대조가 전부 "불일치" 로 보여 원인을 엉뚱한 곳에서 찾게 된다.
command -v dig >/dev/null 2>&1 || die "dig 이 없습니다: sudo apt-get install -y dnsutils"

# 이 서버의 공인 IP(IMDSv2). DNS 대조에 쓴다.
TOKEN="$(curl -fsS -X PUT 'http://169.254.169.254/latest/api/token' \
          -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)"
MYIP="${MYIP:-$(curl -fsS -H "X-aws-ec2-metadata-token: ${TOKEN}" \
        'http://169.254.169.254/latest/meta-data/public-ipv4' 2>/dev/null || true)}"
[[ -n "$MYIP" ]] || die "이 서버의 공인 IP 를 알 수 없습니다. MYIP=<주소> 로 지정하세요."
echo "이 서버: ${MYIP}"

# ── 1) DNS 가 실제로 이 서버를 가리키는지 ──────────────────
# 여기서 막지 않으면 certbot 이 rate limit(주당 5회 실패)을 태우며 무의미하게 실패한다.
log "1) DNS 전파 확인"
bad=0
for n in "${NAMES[@]}"; do
  got="$(dig +short A "$n" @1.1.1.1 2>/dev/null | tail -1)"
  if [[ "$got" == "$MYIP" ]]; then
    printf '  %-34s %s  OK\n' "$n" "$got"
  else
    printf '  %-34s %s  <-- 불일치(기대: %s)\n' "$n" "${got:-없음}" "$MYIP"
    bad=1
  fi
done
[[ $bad -eq 0 ]] || die "A 레코드가 아직 이 서버를 가리키지 않습니다. 등록 후 전파까지 보통 10분~1시간 걸립니다."

# ── 2) 80 포트 도달 확인(http-01 의 통로) ──────────────────
log "2) ACME 경로 도달 확인"
probe="acme-probe-${STAMP}"
mkdir -p "${WEBROOT}/.well-known/acme-challenge"
printf 'ok' > "${WEBROOT}/.well-known/acme-challenge/${probe}"
if ! curl -fsS --max-time 15 "http://${DOMAIN}/.well-known/acme-challenge/${probe}" | grep -q ok; then
  rm -f "${WEBROOT}/.well-known/acme-challenge/${probe}"
  die "http://${DOMAIN}/.well-known/acme-challenge/ 가 응답하지 않습니다. 보안그룹 80 포트와 nginx 를 확인하세요."
fi
rm -f "${WEBROOT}/.well-known/acme-challenge/${probe}"
echo "80 포트 도달 OK"

# ── 3) 발급 ────────────────────────────────────────────────
D_ARGS=(); for n in "${NAMES[@]}"; do D_ARGS+=(-d "$n"); done
EMAIL_ARGS=(--register-unsafely-without-email)
[[ -n "${LE_EMAIL:-}" ]] && EMAIL_ARGS=(-m "${LE_EMAIL}" --no-eff-email)
[[ -n "${LE_EMAIL:-}" ]] || warn "LE_EMAIL 이 없습니다. 90일 인증서라 만료 알림을 받아 두는 편이 안전합니다."

log "3) 발급 리허설(--dry-run: rate limit 소모 없음)"
# --expand: 같은 --cert-name 에 이름을 더 넣어 다시 돌릴 때(서브도메인 추가) 확장을 승인한다.
# 없으면 certbot 이 "기존 인증서와 이름 집합이 다르다"며 물어보다가 비대화형에서 그냥 실패한다.
# 이름이 그대로면 아무 영향이 없다.
certbot certonly --dry-run --non-interactive --agree-tos --expand "${EMAIL_ARGS[@]}" \
  --cert-name "$DOMAIN" --webroot -w "${WEBROOT}" "${D_ARGS[@]}" \
  || die "리허설 실패 — 위 로그에서 어떤 이름이 실패했는지 확인하세요."

log "4) 실제 발급(90일)"
certbot certonly --non-interactive --agree-tos --expand "${EMAIL_ARGS[@]}" \
  --cert-name "$DOMAIN" --webroot -w "${WEBROOT}" "${D_ARGS[@]}" \
  --deploy-hook "systemctl reload nginx" \
  || die "발급 실패"
[[ -f "${LIVE}/fullchain.pem" ]] || die "인증서 파일이 없습니다: ${LIVE}"

# ── 5) 스니펫/설정 배치 ────────────────────────────────────
log "5) nginx 설정 배치"
install -m 0644 -o root -g root "$INFRA/nginx/snippets/hsts.conf"       "$HSTS_SNIPPET"
install -m 0644 -o root -g root "$INFRA/nginx/snippets/tls-domain.conf" "$TLS_SNIPPET"
sed -i "s|/etc/letsencrypt/live/[^/]*/|/etc/letsencrypt/live/${DOMAIN}/|g" "$TLS_SNIPPET"
grep -q "${DOMAIN}" "$TLS_SNIPPET" || die "스니펫 치환 실패 — CERT_DIR 자리를 확인하세요."

# 설정 파일의 도메인을 실제 값으로 바꿔 배치한다(저장소 파일은 예시 도메인을 그대로 둔다).
sed "s|jongeunchoi\.dev|${DOMAIN}|g" "$INFRA/nginx/portfolio-domain.conf" > "$SITE_DOMAIN"
chmod 0644 "$SITE_DOMAIN"

# ── 6) 활성화 + 검증 + 실패 시 원복 ────────────────────────
log "6) 활성화"
ln -sfn "$SITE_DOMAIN" "${ENABLED_DIR}/portfolio-domain"
if ! nginx -t; then
  rm -f "${ENABLED_DIR}/portfolio-domain"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  die "nginx 설정 검증 실패 — 도메인 설정을 껐습니다(기존 IP 접속은 그대로입니다)."
fi
systemctl reload nginx || die "nginx reload 실패"

# ── 7) 실증 ────────────────────────────────────────────────
# reload 는 SIGHUP 만 보내고 즉시 반환한다. 기존 워커는 잠깐 더 살아서 **옛 설정**(도메인 블록이
# 없는 상태)으로 응답하는데, 그러면 default_server 의 IP 인증서가 나가 이름 불일치로 curl 이
# 실패한다. 곧바로 검증하면 멀쩡한 배포를 실패로 판정한다(실제로 겪음) - 그래서 기다리고 재시도한다.
log "7) 실증"
sleep 3
rc=0
for n in "${NAMES[@]}"; do
  [[ "$n" == "www.${DOMAIN}" ]] && continue   # 301 이라 본문이 없다
  code=000
  for _ in 1 2 3 4 5; do
    # curl 은 실패해도 %{http_code} 로 000 을 찍는다. `|| echo` 를 붙이면 000000 이 되어
    # 값이 아니라 노이즈가 남는다 - 종료코드를 무시하고 출력만 받는다.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${n}/" || true)"
    [[ "$code" =~ ^(200|30[0-9])$ ]] && break
    sleep 2
  done
  printf '  %-34s %s\n' "https://${n}/" "$code"
  [[ "$code" =~ ^(200|30[0-9])$ ]] || rc=1
done
echo
if [[ $rc -eq 0 ]]; then
  log "완료 - https://${DOMAIN}/ 로 접속하세요."
  echo "  갱신은 certbot 타이머가 자동으로 합니다: systemctl list-timers | grep certbot"
else
  warn "일부 이름이 정상 응답하지 않았습니다. 각 앱(systemctl is-active portfolio-*)을 확인하세요."
  exit 1
fi
