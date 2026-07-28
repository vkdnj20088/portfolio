#!/usr/bin/env bash
#
# nginx 응답 압축(gzip) 활성화. EC2(Ubuntu) 서버에서 실행.
#   sudo bash scripts/setup-compression.sh
#
# 배경:
#  - Ubuntu 기본 nginx.conf 는 `gzip on;` 만 켜져 있고 `gzip_types` 는 주석 처리돼 있다.
#    gzip_types 기본값은 text/html 하나뿐이라, 정작 가장 큰 자산인 JS/CSS 가 압축되지 않는다.
#    (실측: bundle.js 81.5KB 가 무압축으로 전송되고 있었음)
#  - 이 앱은 정적 파일도 Spring Boot 가 서빙하고 nginx 가 프록시하므로, 엣지(nginx)에서
#    한 번에 압축하는 편이 단순하다. Spring 의 server.compression 과 중복 적용하지 않는다.
#
# 왜 brotli 를 쓰지 않는가(실측 근거):
#  - 페이로드의 91% 인 bundle.js 는 이미 Terser 로 minify 되어 brotli 가 얻을 잉여가 거의 없다.
#    brotli q5 는 gzip -6 대비 겨우 479B(1%), 전체로도 842B(2%) 절감에 그쳤다.
#  - 유의미한 이득이 나는 q11 은 온더플라이 압축에 CPU 가 과하다(t3.micro 부적합).
#  - brotli_static(사전 압축)은 정적 파일이 jar 내부에 있어 nginx 가 직접 읽지 못해 불가.
#  → 모듈 의존성을 늘려 2% 를 얻는 트레이드오프가 성립하지 않는다.
#
# 배포판 nginx.conf 는 수정하지 않는다. conf.d 스니펫으로 넣어 롤백을 파일 삭제로 끝낸다.
# (`gzip on;` 은 이미 nginx.conf 의 http 컨텍스트에 있으므로 여기서 재선언하지 않는다 — 중복 지시자 오류)
#
set -euo pipefail

CONF="/etc/nginx/conf.d/compression.conf"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요: sudo bash $0"

log "0) 사전 점검"
nginx -t || die "현재 nginx 설정이 이미 깨져 있습니다."
grep -qE '^\s*gzip\s+on;' /etc/nginx/nginx.conf \
  || die "nginx.conf 에 'gzip on;' 이 없습니다. 이 스크립트는 그 전제로 동작합니다."

log "1) conf.d 스니펫 작성"
cat > "$CONF" <<'NGINX'
# 응답 압축. `gzip on;` 은 /etc/nginx/nginx.conf 의 http 컨텍스트에 이미 존재한다.
# 여기서는 기본값이 text/html 뿐인 gzip_types 를 실제 자산 타입으로 확장한다.

gzip_vary on;             # 캐시/프록시가 Accept-Encoding 별로 구분하도록 Vary 헤더 부여
gzip_proxied any;         # 프록시 경유 요청도 압축 대상에 포함
gzip_comp_level 5;        # 실측상 9 는 6 대비 52B 만 더 줄임 → CPU 만 낭비. 5~6 이 적정
gzip_min_length 1024;     # 작은 응답은 압축 오버헤드가 이득보다 큼(예: 215B JSON 응답)

gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/javascript
    application/json
    application/xml
    application/xml+rss
    image/svg+xml;        # 파비콘(svg)
NGINX

log "2) 문법 검사"
if ! nginx -t; then
  rm -f "$CONF"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  die "설정 오류 → 스니펫 제거하고 원상 복구했습니다."
fi

log "3) 리로드"
systemctl reload nginx

log "4) 검증 (리로드 반영까지 재시도)"
# HTTPS 로 확인한다. TLS 적용 후 80번은 301 리다이렉트라, http 로 재면 앱이 아니라
# 리다이렉트 본문(178B)을 측정하게 된다. 로컬이므로 -k (인증서는 IP 용, 127.0.0.1 아님).
BASE="https://127.0.0.1"
curl -sk --max-time 3 -o /dev/null "${BASE}/actuator/health" 2>/dev/null || BASE="http://127.0.0.1"

# 자산 경로에는 콘텐츠 해시가 붙어 빌드마다 바뀐다. 하드코딩하면 404 본문을 측정하게 되므로
# index.html 에서 실제 산출물 경로를 읽어온다.
HTML="$(curl -sk --max-time 5 "${BASE}/")"
BUNDLE="$(printf '%s' "$HTML" | grep -oE '/js/bundle\.[0-9a-f]+\.js' | head -1 || true)"
STYLE="$(printf '%s' "$HTML" | grep -oE '/css/style\.[0-9a-f]+\.css' | head -1 || true)"
[[ -n "$BUNDLE" && -n "$STYLE" ]] || die "index.html 에서 해시된 자산 경로를 찾지 못했습니다(빌드 확인 필요)."

for i in $(seq 1 15); do
  enc="$(curl -skI -H 'Accept-Encoding: gzip' --max-time 3 "${BASE}${BUNDLE}" \
         | tr -d '\r' | grep -i '^content-encoding:' || true)"
  [[ -n "$enc" ]] && break
  sleep 1
done

for p in "$BUNDLE" "$STYLE" / ; do
  enc="$(curl -skI -H 'Accept-Encoding: gzip' --max-time 5 "${BASE}${p}" \
         | tr -d '\r' | grep -i '^content-encoding:' | awk '{print $2}' || true)"
  raw="$(curl -sk --max-time 5 -o /dev/null -w '%{size_download}' "${BASE}${p}")"
  gz="$(curl -sk -H 'Accept-Encoding: gzip' --max-time 5 -o /dev/null -w '%{size_download}' "${BASE}${p}")"
  printf "  %-16s encoding=%-6s  %6s B → %6s B\n" "$p" "${enc:--}" "$raw" "$gz"
done

cat <<EOF

$(printf '\033[1;32m완료\033[0m')

[롤백] 압축을 끄려면 스니펫만 지우면 된다(배포판 nginx.conf 는 건드리지 않았음):
  sudo rm -f ${CONF} && sudo nginx -t && sudo systemctl reload nginx
EOF
