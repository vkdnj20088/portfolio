#!/usr/bin/env bash
#
# nginx 엣지 하드닝 적용 - conf.d 드롭인(버전 은닉/타임아웃/rate limit 존/upstream)과
# 갱신된 스니펫·사이트 설정을 배치하고, 검증 후 reload 한다. 실패하면 전부 되돌린다.
#
#   sudo bash infra/apply-hardening.sh
#   sudo DOMAIN=example.dev bash infra/apply-hardening.sh   # 도메인 사이트도 함께 재배치
#
# 무엇을 바꾸나:
#  - conf.d/portfolio-hardening.conf 신규(server_tokens off, slowloris 타임아웃,
#    limit_req/limit_conn 존, upstream keepalive 풀)
#  - snippets/portfolio-proxy-app.conf 갱신(XFF 위조 무효화, upstream keepalive 용 Connection "")
#  - sites-available/portfolio(+portfolio-domain) 갱신(upstream 이름 사용, /api/ rate limit, 닷파일 차단)
#
# 무엇을 건드리지 않나:
#  - snippets/portfolio-tls-*.conf. 여기에는 발급 스크립트가 심어 둔 **실제 인증서 경로**가 있다.
#    저장소 원본에는 CERT_DIR 자리표시자가 들어 있어, 덮으면 nginx 가 없는 파일을 가리키게 된다.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")" && pwd)"
CONFD="/etc/nginx/conf.d"
SNIPPETS="/etc/nginx/snippets"
AVAILABLE="/etc/nginx/sites-available"
ENABLED="/etc/nginx/sites-enabled"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/var/backups/portfolio-nginx-${STAMP}"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[주의] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[실패] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요(sudo)."
command -v nginx >/dev/null 2>&1 || die "nginx 가 없습니다."

# ── 0) 되돌릴 수 있게 먼저 백업 ─────────────────────────────
log "0) 백업: ${BACKUP}"
mkdir -p "$BACKUP"
for f in "${CONFD}/portfolio-hardening.conf" \
         "${SNIPPETS}/portfolio-proxy-app.conf" \
         "${AVAILABLE}/portfolio" \
         "${AVAILABLE}/portfolio-domain"; do
  [[ -f "$f" ]] && cp -a "$f" "${BACKUP}/$(basename "$f")"
done
echo "백업한 파일: $(ls -1 "$BACKUP" 2>/dev/null | wc -l)개"

rollback() {
  warn "되돌리는 중..."
  # 이번 실행에서 새로 만든 파일은 백업에 없다 - 지운다.
  [[ -f "${BACKUP}/portfolio-hardening.conf" ]] \
    && cp -a "${BACKUP}/portfolio-hardening.conf" "${CONFD}/" \
    || rm -f "${CONFD}/portfolio-hardening.conf"
  for n in portfolio-proxy-app.conf; do
    [[ -f "${BACKUP}/${n}" ]] && cp -a "${BACKUP}/${n}" "${SNIPPETS}/"
  done
  for n in portfolio portfolio-domain; do
    [[ -f "${BACKUP}/${n}" ]] && cp -a "${BACKUP}/${n}" "${AVAILABLE}/"
  done
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
    warn "원복 완료 - 서비스는 이전 설정으로 돌아갔습니다."
  else
    die "원복 후에도 nginx -t 가 실패합니다. ${BACKUP} 을 직접 확인하세요."
  fi
}

# ── 1) 배치 ─────────────────────────────────────────────────
log "1) 설정 배치"
install -d "$CONFD" "$SNIPPETS"
install -m 0644 -o root -g root "$INFRA/nginx/conf.d/portfolio-hardening.conf" "${CONFD}/portfolio-hardening.conf"
install -m 0644 -o root -g root "$INFRA/nginx/snippets/proxy-app.conf"          "${SNIPPETS}/portfolio-proxy-app.conf"
install -m 0644 -o root -g root "$INFRA/nginx/snippets/hsts.conf"               "${SNIPPETS}/portfolio-hsts.conf"
install -m 0644 -o root -g root "$INFRA/nginx/portfolio.conf"                   "${AVAILABLE}/portfolio"
echo "conf.d / snippets / portfolio 배치 완료"

# 도메인 사이트가 이미 켜져 있으면 함께 갱신한다. 저장소 파일에는 예시 도메인이 박혀 있으므로
# 실제 도메인으로 치환해야 한다 - 인자로 받거나, 지금 깔려 있는 파일에서 읽어낸다.
if [[ -f "${AVAILABLE}/portfolio-domain" ]]; then
  DOM="${DOMAIN:-$(grep -oE 'server_name[[:space:]]+www\.[a-z0-9.-]+' "${AVAILABLE}/portfolio-domain" \
        | head -1 | sed 's/.*www\.//')}"
  [[ -n "$DOM" ]] || die "도메인을 알 수 없습니다. DOMAIN=<도메인> 으로 지정하세요."
  sed "s|jongeunchoi\.dev|${DOM}|g" "$INFRA/nginx/portfolio-domain.conf" > "${AVAILABLE}/portfolio-domain"
  chmod 0644 "${AVAILABLE}/portfolio-domain"
  echo "portfolio-domain 갱신 완료 (도메인: ${DOM})"
else
  warn "도메인 사이트가 없습니다 - IP(포트) 설정만 갱신했습니다."
fi

# ── 2) 검증 ─────────────────────────────────────────────────
log "2) nginx -t"
if ! nginx -t; then
  rollback
  die "설정 검증 실패 - 위 오류를 보고 저장소 파일을 고치세요."
fi

log "3) reload"
systemctl reload nginx || { rollback; die "reload 실패"; }

# ── 4) 실증 ─────────────────────────────────────────────────
# reload 는 SIGHUP 만 보내고 즉시 반환한다. 기존 워커가 잠깐 더 옛 설정으로 응답하므로 기다린다.
log "4) 실증"
sleep 3
rc=0
declare -a TARGETS=("https://127.0.0.1/")
if [[ -n "${DOM:-}" ]]; then
  TARGETS=("https://${DOM}/" "https://chat.${DOM}/" "https://docqa.${DOM}/" \
           "https://exchange.${DOM}/" "https://file.${DOM}/" "https://ip.${DOM}/")
fi
for u in "${TARGETS[@]}"; do
  code=000
  for _ in 1 2 3 4 5; do
    code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "$u" || true)"
    [[ "$code" =~ ^(200|30[0-9])$ ]] && break
    sleep 2
  done
  printf '  %-38s %s\n' "$u" "$code"
  [[ "$code" =~ ^(200|30[0-9])$ ]] || rc=1
done

# 버전 은닉이 실제로 걸렸는지(서버 헤더에 버전이 없어야 한다)
srv="$(curl -skI --max-time 10 "https://127.0.0.1/" | grep -i '^server:' | tr -d '\r' || true)"
printf '  %-38s %s\n' "Server 헤더" "${srv:-(없음)}"
[[ "$srv" =~ nginx/[0-9] ]] && { warn "버전이 아직 노출됩니다 - server_tokens off 가 안 먹었습니다."; rc=1; }

echo
if [[ $rc -eq 0 ]]; then
  log "완료 - 백업은 ${BACKUP} 에 있습니다."
else
  warn "일부 검증이 실패했습니다. 되돌리려면: sudo cp -a ${BACKUP}/* 해당 위치 후 nginx -t && systemctl reload nginx"
  exit 1
fi
