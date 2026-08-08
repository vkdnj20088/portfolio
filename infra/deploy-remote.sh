#!/usr/bin/env bash
# GitHub Actions 러너에서 실행한다. dist/<앱> 아티팩트를 서버로 옮기고, 타임스탬프 릴리스로
# 원자 교체 -> 재기동 -> 헬스 게이트 -> 실패 시 직전 릴리스로 롤백.
# 배포가 나쁜 빌드로 사이트를 죽이지 않게 하는 안전장치다.
#
# 필요 env: HOST, USER (SSH 대상), TARGET(all|intro|chat|docqa|exchange|backend|loandoc). SSH 키는 워크플로가 준비한다.
set -euo pipefail

: "${HOST:?HOST 필요}"
: "${USER:?USER 필요}"
TARGET="${TARGET:-all}"
STAMP="$(date +%Y%m%d%H%M%S)"
SSH_OPTS="-o StrictHostKeyChecking=yes"
SSH="ssh ${SSH_OPTS} ${USER}@${HOST}"

# 앱 = 릴리스 디렉터리 + systemd 유닛 + 헬스 URL(서버 로컬)
# 인트로는 정적이라 이 표에 없다(아래 deploy_intro 가 따로 다룬다).
health_url() {
  case "$1" in
    chat)     echo "http://127.0.0.1:3000/" ;;
    docqa)    echo "http://127.0.0.1:3030/" ;;
    exchange) echo "http://127.0.0.1:3010/" ;;
    backend)  echo "http://127.0.0.1:8080/actuator/health" ;;
    loandoc)  echo "http://127.0.0.1:8000/healthz" ;;
    *) return 1 ;;
  esac
}

# 전송 후·재기동 전 후처리. 파이썬 앱은 빌드 산출물이 없어 소스 + 잠긴 requirements 를
# 옮기고, 의존성은 릴리스 안 venv 로 세운다 - 릴리스마다 독립 venv 라 롤백이 코드와
# 의존성을 함께 되돌린다(공유 venv 였다면 롤백해도 의존성은 새 버전으로 남는다).
post_transfer() {
  case "$1" in
    loandoc)
      echo "== loandoc: venv 구성(잠긴 requirements) =="
      $SSH "cd '$2' && python3 -m venv venv && ./venv/bin/pip install --quiet -r requirements-web.txt"
      ;;
  esac
}

# 헬스 게이트 대기 시간(2초 간격 시도 횟수). JVM 과 Node 를 같은 값으로 재면 안 된다 -
# Next standalone 은 1~2초면 응답하지만, Spring Boot 는 t4g.small(2 vCPU, 콜드 JIT) 첫 기동에
# Flyway 마이그레이션까지 겹쳐 60초를 넘기는 일이 흔하다. 그 60초 한도가 정상 기동을 실패로 판정했다.
health_tries() {
  case "$1" in
    backend) echo 90 ;;   # 최대 180초
    *)       echo 30 ;;   # 최대 60초
  esac
}

deploy_one() {
  local name="$1"
  local health; health="$(health_url "$name")"
  local base="/opt/portfolio/${name}"
  local release="${base}/releases/${STAMP}"

  echo "== ${name}: 전송 =="
  $SSH "mkdir -p '${release}'"
  rsync -az --delete -e "ssh ${SSH_OPTS}" "dist/${name}/" "${USER}@${HOST}:${release}/"
  post_transfer "${name}" "${release}"

  echo "== ${name}: 릴리스 교체 + 재기동 =="
  # reset-failed 를 먼저 부른다. 이전 배포가 크래시 루프로 재시작 한도(StartLimitBurst)에 걸려 있으면
  # restart 만으로는 "Start request repeated too quickly" 로 거부돼, 고친 배포조차 못 뜬다.
  $SSH "sudo systemctl reset-failed portfolio-${name} || true; ln -sfn '${release}' '${base}/current' && sudo systemctl restart portfolio-${name}"

  local tries; tries="$(health_tries "$name")"
  echo "== ${name}: 헬스 게이트(최대 $((tries * 2))s) =="
  if $SSH "for i in \$(seq 1 ${tries}); do curl -fsS '${health}' >/dev/null 2>&1 && exit 0; sleep 2; done; exit 1"; then
    echo "${name} healthy"
    # 최근 3개 릴리스만 유지(롤백 여지를 남기고 디스크는 아낀다 - 2GB 인스턴스의 EBS 도 유한하다).
    $SSH "ls -1dt '${base}'/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf"
  else
    # 실패 원인을 러너 로그에 남긴다. 이게 없으면 "왜 죽었는지"를 보려고 매번 서버에 SSH 로
    # 들어가야 한다 - 배포 로그만 보고 진단할 수 있어야 한다.
    echo "!! ${name} 헬스 실패 -> 서비스 상태/로그 (마지막 40줄)"
    $SSH "systemctl status portfolio-${name} --no-pager -l | head -20; echo '--- journal ---'; journalctl -u portfolio-${name} -n 40 --no-pager" || echo "(로그 조회 실패)"
    echo "!! ${name} -> 직전 릴리스로 롤백"
    local prev
    prev="$($SSH "ls -1dt '${base}'/releases/*/ 2>/dev/null | sed -n 2p" | tr -d '\r')"
    if [ -n "${prev}" ]; then
      $SSH "ln -sfn '${prev%/}' '${base}/current' && sudo systemctl restart portfolio-${name}"
      echo "롤백 완료: ${prev}"
    else
      echo "롤백할 이전 릴리스가 없다(최초 배포)."
    fi
    return 1
  fi
}

# 인트로는 nginx 가 직접 서빙하는 정적 파일이라 릴리스/재기동/롤백이 없다.
# 대신 --delete 로 통째로 맞추고, 전송 후 nginx 로 200 을 확인한다.
deploy_intro() {
  echo "== intro: 전송 =="
  rsync -az --delete -e "ssh ${SSH_OPTS}" "dist/intro/" "${USER}@${HOST}:/var/www/intro/"
  echo "== intro: 헬스 게이트 =="
  $SSH "curl -fsS -o /dev/null 'http://127.0.0.1/' -H 'Host: localhost' || curl -fsSk -o /dev/null 'https://127.0.0.1/'"
}

# systemd 유닛을 저장소 기준으로 맞춘다. 이게 없으면 유닛(예: JVM 플래그)을 고쳐도 서버에는
# 반영되지 않아, 사람이 SSH 로 들어가 cp + daemon-reload 를 해야 한다(실제로 그랬다).
# 헬퍼(/usr/local/sbin/portfolio-sync-units)가 아직 없는 서버에서는 조용히 건너뛴다 -
# 이 단계 때문에 배포 전체가 실패하면 안 된다.
sync_units() {
  echo "== systemd 유닛 동기화 =="
  $SSH "mkdir -p /opt/portfolio/units"
  rsync -az -e "ssh ${SSH_OPTS}" infra/systemd/ "${USER}@${HOST}:/opt/portfolio/units/"
  if $SSH "sudo -n /usr/local/sbin/portfolio-sync-units"; then
    echo "유닛 반영 완료"
  else
    echo "(유닛 자동 반영 헬퍼가 없어 건너뜁니다 - infra/README 의 1회 설치 참고)"
  fi
}

should() { [ "${TARGET}" = "all" ] || [ "${TARGET}" = "$1" ]; }

rc=0
# 유닛을 먼저 맞춘 뒤 앱을 올린다 - 순서가 반대면 이번 배포는 옛 유닛으로 뜬다.
sync_units || echo "(유닛 동기화 단계에서 문제가 있었지만 배포는 계속합니다)"

# 백엔드를 먼저 - DB 마이그레이션(Flyway)이 있어 가장 오래 걸리고, 실패 시 나머지를 건드리지 않는다.
if should backend  && [ "${rc}" -eq 0 ]; then deploy_one backend  || rc=1; fi
if should chat     && [ "${rc}" -eq 0 ]; then deploy_one chat     || rc=1; fi
if should docqa    && [ "${rc}" -eq 0 ]; then deploy_one docqa    || rc=1; fi
if should exchange && [ "${rc}" -eq 0 ]; then deploy_one exchange || rc=1; fi
if should loandoc  && [ "${rc}" -eq 0 ]; then deploy_one loandoc  || rc=1; fi
if should intro    && [ "${rc}" -eq 0 ]; then deploy_intro        || rc=1; fi

if [ "${rc}" -eq 0 ]; then
  echo "배포 완료 (${STAMP})"
else
  echo "배포 실패 - 위 로그 참조(해당 서비스는 이전 릴리스로 복구됨)"
fi
exit "${rc}"
