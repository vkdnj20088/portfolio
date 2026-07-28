#!/usr/bin/env bash
#
# nginx 정적 자산 캐시 정책. EC2(Ubuntu) 서버에서 실행.
#   sudo bash scripts/setup-cache-headers.sh
#
# 원칙: **해시된 것만 캐시한다.**
#  - `bundle.<contenthash>.js` / `style.<contenthash>.css` 는 내용이 바뀌면 파일명이 바뀐다
#    -> 낡은 응답이 재사용될 수 없다 -> `immutable` 장기 캐시가 안전하다(재방문 시 요청 자체가 사라짐).
#  - HTML/favicon/API 처럼 파일명이 고정된 것은 `no-cache`(저장은 하되 항상 재검증) -> 304 만 오간다.
#    여기에 max-age 를 걸면 재배포 후 낡은 자산이 남는다. 그게 캐시의 진짜 위험이다.
#
# CSS 는 원래 손으로 관리하는 style.css 였다(= 해시 없음 = no-cache 고정). SCSS 를 webpack
# 파이프라인에 넣으면서 JS 와 동일하게 콘텐츠 해시가 붙었고, 그래서 이제 캐시 대상이 된다.
# 순서가 중요하다: 무효화(해시)를 먼저 풀었기 때문에 캐시를 걸 수 있는 것이다.
#
# 왜 "1시간 캐시" 같은 절충을 하지 않았나:
#  - 해시가 없는 자산에 max-age 를 걸면 그 시간만큼 낡은 화면이 서빙된다. HTML 과 JS 의 버전이
#    어긋나면 화면이 깨질 수도 있다. 이득(왕복 1회 ~30ms)보다 리스크가 크다.
#  - 캐시는 무효화를 푼 다음에 걸어야 한다. 그래서 먼저 콘텐츠 해시를 도입했다.
#
# 배포판 nginx.conf 와 vhost 를 수정하지 않는다. conf.d 스니펫이라 롤백은 파일 삭제로 끝난다.
# (`map` 과 `add_header` 는 http 컨텍스트에 둘 수 있고, 하위 server/location 이 자체 add_header 를
#  선언하지 않는 한 그대로 상속된다 - 현재 vhost 는 add_header 를 쓰지 않는다.)
#
set -euo pipefail

CONF="/etc/nginx/conf.d/cache.conf"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요: sudo bash $0"

log "0) 사전 점검"
nginx -t || die "현재 nginx 설정이 이미 깨져 있습니다."
if grep -rqE '^\s*add_header' /etc/nginx/sites-enabled/ 2>/dev/null; then
  die "vhost 에 add_header 가 있습니다. http 컨텍스트 상속이 무효화되므로 스크립트를 조정하세요."
fi

log "1) conf.d 스니펫 작성"
cat > "$CONF" <<'NGINX'
# 캐시 정책 - 해시된 자산만 장기 캐시한다.
#   bundle.<contenthash>.js / style.<contenthash>.css : 내용이 바뀌면 파일명이 바뀌므로
#                                                       영구 캐시가 안전(immutable)
#   그 외(HTML/favicon/API) : 파일명이 고정 -> 항상 재검증(no-cache) -> 조건부 요청으로 304
# no-cache 는 "저장 금지"가 아니라 "쓰기 전 재검증"이다(no-store 아님).
map $uri $app_cache_control {
    default                             "no-cache";
    "~^/js/bundle\.[0-9a-f]+\.js$"     "public, max-age=31536000, immutable";
    "~^/css/style\.[0-9a-f]+\.css$"    "public, max-age=31536000, immutable";
}

add_header Cache-Control $app_cache_control always;
NGINX

log "2) 문법 검사"
if ! nginx -t; then
  rm -f "$CONF"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  die "설정 오류 → 스니펫 제거하고 원상 복구했습니다."
fi

log "3) 리로드"
systemctl reload nginx

log "4) 검증"
BASE="https://127.0.0.1"
curl -sk --max-time 3 -o /dev/null "${BASE}/actuator/health" 2>/dev/null || BASE="http://127.0.0.1"

# 해시는 빌드마다 바뀌므로 경로를 하드코딩하지 않는다. index.html 이 실제 산출물 이름을
# 담고 있으니 거기서 읽는다(= 배포된 것을 검증한다).
HTML="$(curl -sk --max-time 5 "${BASE}/")"
BUNDLE="$(printf '%s' "$HTML" | grep -oE '/js/bundle\.[0-9a-f]+\.js' | head -1 || true)"
STYLE="$(printf '%s' "$HTML" | grep -oE '/css/style\.[0-9a-f]+\.css' | head -1 || true)"
[[ -n "$BUNDLE" ]] || die "index.html 에서 해시된 번들 경로를 찾지 못했습니다(빌드 확인 필요)."
[[ -n "$STYLE" ]] || die "index.html 에서 해시된 스타일 경로를 찾지 못했습니다(빌드 확인 필요)."
echo "  감지된 번들: ${BUNDLE}"
echo "  감지된 스타일: ${STYLE}"

for i in $(seq 1 15); do
  cc="$(curl -skI --max-time 3 "${BASE}${BUNDLE}" | tr -d '\r' | grep -i '^cache-control:' || true)"
  [[ -n "$cc" ]] && break
  sleep 1
done

for p in "$BUNDLE" "$STYLE" / /favicon.svg /api/extensions/fixed; do
  cc="$(curl -skI --max-time 5 "${BASE}${p}" | tr -d '\r' | grep -i '^cache-control:' | cut -d' ' -f2- || true)"
  printf "  %-34s cache-control: %s\n" "$p" "${cc:--}"
done

cat <<EOF

$(printf '\033[1;32m완료\033[0m')

[롤백] 캐시 정책을 되돌리려면 스니펫만 지우면 된다:
  sudo rm -f ${CONF} && sudo nginx -t && sudo systemctl reload nginx
EOF
