#!/usr/bin/env bash
# 공개 데모의 표본 데이터를 복구한다. portfolio-demo-reseed.timer 가 한 시간마다 부른다.
#
# 수동 실행:  sudo bash /opt/portfolio/infra/demo-reseed.sh
# 로그 확인:  journalctl -u portfolio-demo-reseed -n 30 --no-pager
#
# 자격증명은 백엔드가 쓰는 /etc/portfolio/backend.env 를 그대로 읽는다. 재시드 전용 계정을
# 따로 두지 않는 이유: 계정이 둘이면 비밀번호가 갈라지고, 갈라진 쪽은 조용히 실패한다.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/portfolio/backend.env}"
SQL_FILE="${SQL_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/demo-reseed.sql}"
CONTAINER="${CONTAINER:-extdb-mysql}"

log() { printf '[재시드] %s\n' "$*"; }
die() { printf '[재시드-실패] %s\n' "$*" >&2; exit 1; }

[[ -r "$ENV_FILE" ]] || die "$ENV_FILE 을 읽을 수 없습니다(root 로 실행하세요)."
[[ -r "$SQL_FILE" ]] || die "$SQL_FILE 이 없습니다."

# backend.env 는 KEY=VALUE 뿐이다. source 대신 필요한 세 값만 뽑아 쓴다 - 이 파일에 무엇이
# 추가되든 이 스크립트의 셸 환경으로 새지 않게 한다.
read_env() { grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }
DB_NAME="$(read_env DB_NAME)"
DB_USER="$(read_env DB_USER)"
DB_PASSWORD="$(read_env DB_PASSWORD)"
[[ -n "$DB_NAME" && -n "$DB_USER" && -n "$DB_PASSWORD" ]] || die "$ENV_FILE 에 DB_NAME/DB_USER/DB_PASSWORD 가 필요합니다."

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "MySQL 컨테이너($CONTAINER)가 떠 있지 않습니다."

# 비밀번호는 인자로 넘기지 않는다(ps 에 노출된다). 환경변수로 컨테이너 안에만 전달한다.
run_sql() {
  docker exec -i -e MYSQL_PWD="$DB_PASSWORD" "$CONTAINER" \
    mysql --default-character-set=utf8mb4 -u"$DB_USER" "$DB_NAME" "$@"
}

count() { run_sql -N -B -e "SELECT COUNT(*) FROM $1;" 2>/dev/null | tr -d '[:space:]'; }

before_ip="$(count ip_access_rule)"
before_ce="$(count custom_extension)"

run_sql < "$SQL_FILE" || die "SQL 적용에 실패했습니다."

after_ip="$(count ip_access_rule)"
after_ce="$(count custom_extension)"
blocked="$(run_sql -N -B -e "SELECT GROUP_CONCAT(name ORDER BY name) FROM fixed_extension WHERE is_blocked;" | tr -d '[:space:]')"

log "IP 규칙 ${before_ip} -> ${after_ip} / 커스텀 확장자 ${before_ce} -> ${after_ce} / 차단중 고정확장자 ${blocked:-없음}"

# 표본이 비어 있으면 복구가 안 된 것이다. 타이머가 조용히 도는 상황에서 이 조건이 유일한 경보다.
[[ "${after_ip:-0}" -ge 3 && "${after_ce:-0}" -ge 4 ]] \
  || die "복구 후에도 표본이 부족합니다(IP ${after_ip}, 커스텀 ${after_ce})."
log "완료"
