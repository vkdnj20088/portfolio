#!/usr/bin/env bash
#
# nginx 버전 노출 제거. EC2(Ubuntu) 서버에서 실행.
#   sudo bash scripts/setup-server-tokens.sh
#
# 기본 nginx 는 `Server: nginx/1.24.0 (Ubuntu)` 처럼 **정확한 버전과 배포판**을 응답 헤더로 알려준다.
# 그 자체가 취약점은 아니지만, 공격자에게 "어떤 CVE 를 시도할지" 를 알려주는 정찰 정보다.
# `server_tokens off` 로 `Server: nginx` 까지만 남긴다.
#
# 참고: 헤더를 완전히 지우려면 서드파티 모듈(headers-more)이 필요하다. 표준 nginx 로 가능한 최선이
# `server_tokens off` 이며, 모듈 의존성을 추가할 만큼의 이득은 아니라고 판단해 여기까지만 한다.
#
# 배포판 nginx.conf 를 수정하지 않는다. conf.d 스니펫이라 롤백은 파일 삭제로 끝난다.
#
set -euo pipefail

CONF="/etc/nginx/conf.d/server-tokens.conf"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "root 로 실행하세요: sudo bash $0"

log "0) 사전 점검"
nginx -t || die "현재 nginx 설정이 이미 깨져 있습니다."
echo -n "  변경 전: "; curl -sI --max-time 5 http://127.0.0.1/ | tr -d '\r' | grep -i '^server:' || true

log "1) conf.d 스니펫 작성"
cat > "$CONF" <<'NGINX'
# 응답 Server 헤더에서 버전/배포판을 숨긴다 -> "nginx/1.24.0 (Ubuntu)" 대신 "nginx".
# 정찰 난이도를 조금 올릴 뿐 그 자체로 방어는 아니지만, 굳이 알려줄 이유도 없다.
server_tokens off;
NGINX

log "2) 문법 검사"
if ! nginx -t; then
  rm -f "$CONF"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  die "설정 오류 → 스니펫 제거하고 원상 복구했습니다."
fi

log "3) 리로드 + 검증"
systemctl reload nginx
for i in $(seq 1 15); do
  s="$(curl -sI --max-time 3 http://127.0.0.1/ | tr -d '\r' | grep -i '^server:' || true)"
  [[ "$s" == *"nginx"* && "$s" != *"/"* ]] && break
  sleep 1
done
echo -n "  변경 후: "; curl -sI --max-time 5 http://127.0.0.1/ | tr -d '\r' | grep -i '^server:' || true

cat <<EOF

$(printf '\033[1;32m완료\033[0m')

[롤백] sudo rm -f ${CONF} && sudo nginx -t && sudo systemctl reload nginx
EOF
