#!/usr/bin/env bash
#
# k8s 실험실 - 클러스터를 세우고, 실험을 돌리고, 숫자를 남긴다.
#
# 이 스크립트가 로컬과 CI 에서 **같은 것**을 돌린다. 사람이 손으로 kubectl 을 두드려 얻은
# 숫자는 다음 사람이 재현할 수 없고, 재현할 수 없는 숫자는 포트폴리오에 적을 수 없다.
#
#   ./k8s/scripts/lab.sh up          클러스터 + 이미지 + 배포
#   ./k8s/scripts/lab.sh measure     실험 전부 실행 후 k8s/results/runs.json 갱신
#   ./k8s/scripts/lab.sh down        클러스터 제거
set -euo pipefail

NS=portfolio
CLUSTER=portfolio
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S="$ROOT/k8s"
GUARD_URL="http://localhost:30080"
RESULTS="$K8S/results/runs.json"

log() { printf '\n\033[1m== %s\033[0m\n' "$*" >&2; }

# 질의 한 번. 실패를 **삼키지 않는다** - 처음 CI 에서 이 함수가 조용히 1 을 돌려주는 바람에
# 실험 첫 줄에서 멈췄는데 무엇이 없어서 멈췄는지 로그에 아무것도 남지 않았다. 비밀번호 경고만
# 걸러내고 진짜 오류는 질의와 함께 올린다. 클러스터 왕복은 가끔 흔들리므로 세 번까지 본다 -
# 다만 몇 번째에 됐는지를 적는다(조용한 재시도는 불안정을 안정으로 보이게 한다).
sql() {
  local q="$1" out err rc attempt
  err=$(mktemp)
  for attempt in 1 2 3; do
    # rc 를 조건문 밖에서 줍지 않는다 - if 가 끝난 뒤의 $? 는 조건의 실패를 그대로 담지 않아
    # 실패를 0 으로 돌려줄 수 있다. 실패를 성공으로 바꾸는 자리는 만들지 않는다.
    out=$(kubectl -n "$NS" exec mysql-0 -- sh -c "mysql -uext -plabpass extdb -N -B -e \"$q\"" 2>"$err") && rc=0 || rc=$?
    if [ "$rc" -eq 0 ]; then
      [ "$attempt" -gt 1 ] && echo "  (sql ${attempt}회차에 성공)" >&2
      rm -f "$err"
      printf '%s\n' "$out"
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 3
  done
  {
    echo "sql 실패(rc=$rc, 3회 시도): $q"
    grep -v 'Using a password on the command line' "$err" || true
  } >&2
  rm -f "$err"
  return "$rc"
}

# 성공 여부만 보는 조용한 질의(폴링 전용). 사람에게 실패를 말해야 하는 자리에는 sql() 를 쓴다.
sql_try() { kubectl -n "$NS" exec mysql-0 -- sh -c "mysql -uext -plabpass extdb -N -B -e \"$1\"" >/dev/null 2>&1; }

# 멈췄을 때 사람이 볼 것들. 로컬에서는 손으로 볼 수 있지만 CI 에서는 이때 안 찍으면 영원히 못 본다.
dump_diag() {
  kubectl -n "$NS" get pods -o wide >&2 || true
  kubectl -n "$NS" get events --sort-by=.lastTimestamp 2>&1 | tail -25 >&2 || true
  kubectl -n "$NS" logs -l role=web --tail=40 >&2 || true
}

# 실험 전 전제 확인. 전제가 깨졌을 때 실험 도중에 조용히 죽는 대신 **무엇이 없는지** 말하게 한다.
# 버전을 찍는 것은 장식이 아니다 - 로컬과 CI 가 같은 클러스터를 도는지가 이 실험실의 전제라,
# 결과를 옮겨 말하려면 두 곳의 버전이 로그에 남아 있어야 한다.
preflight() {
  log "사전 점검"
  kubectl version 2>&1 | sed 's/^/  /' >&2 || true
  kubectl -n "$NS" get pods -o wide >&2 || { echo "클러스터에 닿지 않는다" >&2; return 1; }

  # 앱이 정말 prod(MySQL)로 떴는지는 스키마 이력 테이블의 존재가 말해 준다. 기본 프로파일로
  # 뜨면 H2 라 여기에 아무것도 없고, 그때 실험은 **다른 데이터베이스를 세는 일**이 된다.
  local i
  for i in $(seq 1 30); do
    sql_try "SELECT COUNT(*) FROM flyway_schema_history" && return 0
    sleep 2
  done
  echo "60초를 기다려도 extdb.flyway_schema_history 에 질의할 수 없다 - 아래를 보라." >&2
  sql "SHOW TABLES" >&2 || true
  dump_diag
  return 1
}

# ── 세우기 ────────────────────────────────────────────────────────────────
build_images() {
  log "이미지 빌드"
  ( cd "$ROOT/portfolio_jquery_spring" && ./gradlew bootJar -q )
  docker build -q --build-arg GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD)" \
    -t portfolio/guard:dev "$ROOT/portfolio_jquery_spring" >/dev/null
  docker build -q -t portfolio/loandoc:dev "$ROOT/portfolio_python_fastapi" >/dev/null
  docker pull -q mysql:8.4 >/dev/null
  # kind 노드는 호스트 도커의 이미지를 보지 못한다 - 명시적으로 적재한다.
  kind load docker-image portfolio/guard:dev portfolio/loandoc:dev mysql:8.4 --name "$CLUSTER" >/dev/null
}

up() {
  if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    log "kind 클러스터 생성"
    kind create cluster --config "$K8S/cluster/kind-cluster.yaml" --wait 180s
  fi
  build_images
  log "배포"
  kubectl apply -f "$K8S/cluster/namespace.yaml"
  kubectl apply -f "$K8S/mysql/statefulset.yaml"
  kubectl -n "$NS" rollout status statefulset/mysql --timeout=300s
  kubectl apply -f "$K8S/loandoc/" -f "$K8S/guard/"
  kubectl -n "$NS" rollout status deploy/loandoc --timeout=300s
  kubectl -n "$NS" rollout status deploy/guard-web --timeout=300s
  kubectl -n "$NS" rollout status deploy/guard-worker --timeout=300s
}

down() { kind delete cluster --name "$CLUSTER"; }

status() { kubectl -n "$NS" get pods,svc,pdb -o wide; }

# ── 부하와 대기 ───────────────────────────────────────────────────────────
# failPersist 를 항상 보낸다. 기본값이 있는 boolean 인데도 빠지면 400 이다(record 의
# 원시 타입 구성요소라 역직렬화가 요구한다) - 실측으로 확인하고 여기 적어 둔다.
enqueue() {
  local run_id="$1" count="$2" scenario="$3"
  for i in $(seq 1 "$count"); do
    curl -sS -o /dev/null -X POST "$GUARD_URL/api/relay/jobs" \
      -H 'Content-Type: application/json' \
      -d "{\"idempotencyKey\":\"lab-$run_id-$i\",\"type\":\"WEBHOOK_PUSH\",\"scenario\":\"$scenario\",\"seed\":$i,\"maxAttempts\":3,\"publishMode\":\"OUTBOX\",\"failPersist\":false}" || true
  done
  # 들어간 것을 **DB 에서** 센다. HTTP 응답만 보면 포트 매핑이 끊겼거나 요청이 거절돼도
  # 실험은 계속 돌고, 끝에 가서 "작업 200건 중 0건만 종단에 닿았다"는 엉뚱한 결론이 남는다.
  # 부하가 안 들어간 것과 워커가 일을 안 한 것은 다른 사건이라 여기서 갈라 놓는다.
  local got
  got=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%'")
  if [ "$got" != "$count" ]; then
    echo "예약이 ${count}건 중 ${got}건만 들어갔다 - 부하가 성립하지 않아 실험을 멈춘다($GUARD_URL)" >&2
    return 1
  fi
}

# 이 실행의 작업이 전부 종단에 닿을 때까지 기다린다. 타임아웃은 실패가 아니라 사실이므로
# 남은 건수를 그대로 돌려주고, 호출자가 결과에 적는다.
wait_drain() {
  local run_id="$1" timeout="${2:-120}" left
  for _ in $(seq 1 "$timeout"); do
    left=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status IN ('PENDING','RUNNING','RETRYING')")
    [ "${left:-1}" = "0" ] && { echo 0; return; }
    sleep 1
  done
  echo "${left:-unknown}"
}

# 실험 전 큐를 비운다. 앞 실험이 남긴 작업이 큐에 쌓여 있으면 새 작업이 뒤로 밀려
# "워커가 집지 않는다"처럼 보인다 - 실제로 그렇게 오독했다. 실험마다 같은 출발선에서 시작한다.
reset_queue() {
  sql "SET FOREIGN_KEY_CHECKS=0; TRUNCATE relay_attempt; TRUNCATE relay_job; TRUNCATE relay_outbox; SET FOREIGN_KEY_CHECKS=1;"
}

now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

# 로그를 어디서부터 셀지의 기준 시각. **클러스터의 시계**로 잡는다 - 호스트(맥)와 노드(리눅스 VM)는
# 다른 시계인데 kubectl logs --since-time 은 노드가 찍은 시각과 비교하기 때문이다. MySQL 도 워커도
# 같은 노드 커널 위에 있어 둘의 시계는 같다.
#
# 여유를 두지 않는다. 처음엔 시계 어긋남을 걱정해 5초를 뺐는데, 같은 모드를 연달아 돌리면
# 한 회차가 7초 만에 끝나서 그 5초가 **앞 회차를 삼켰다**(20건을 돌렸는데 40이 나왔다).
# 같은 시계를 쓰는데 여유를 두는 것은 정확도를 사서 경계를 파는 일이다.
log_since() { sql "SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ')"; }

# 파드별 경합 건수. leaseMode=NONE 에서 무엇이 대신 막았는지의 증거다 -
# 리스 경합(낙관적 락이 리스에서 걸림)과 시도 경합(실행 직전에 걸림)을 갈라 센다.
#
# 시각으로 자르는 이유: 파드가 재시작되면 로그도 새로 시작하지만, **같은 설정을 연달아 돌리면**
# set env 가 아무것도 바꾸지 않아 롤아웃이 일어나지 않는다. 그때는 앞 실행의 로그가 그대로 남아
# 숫자가 부푼다(20건을 돌렸는데 73/93 이 나왔다). 증거로 쓸 숫자라면 경계가 분명해야 한다.
conflict_counts() {
  local kind="$1" since="$2" total=0 n
  for pod in $(kubectl -n "$NS" get pods -l role=worker -o name); do
    n=$(kubectl -n "$NS" logs "$pod" --since-time="$since" 2>/dev/null | grep -c "relay $kind conflict" || true)
    total=$((total + n))
  done
  echo "$total"
}

# 워커 파드별로 이 실행에서 시도를 몇 번 실행했는지. "정말 둘 다 일했는가"의 증거다.
pod_work_counts() {
  local since="$1" pod n
  for pod in $(kubectl -n "$NS" get pods -l role=worker -o name); do
    n=$(kubectl -n "$NS" logs "$pod" --since-time="$since" 2>/dev/null | grep -cE 'relay attempt (ok|failed)|relay job dead-lettered' || true)
    printf '%s=%s ' "${pod#pod/}" "$n"
  done
}

# ── 실험 1: 워커 2 파드 × 부하 N ─────────────────────────────────────────
# 코드에 있던 다중 인스턴스 능력을 처음으로 켠다. 확인할 것은 셋이다 -
# (1) 모든 작업이 종단에 닿았는가 (2) 시도가 겹쳐 기록되지 않았는가 (3) 정말 둘 다 일했는가.
# (3)이 없으면 한 파드가 전부 처리하고 다른 파드는 논 것을 "안전하다"고 착각한다.
exp_two_workers() {
  local mode="${1:-SKIP_LOCKED}" n="${2:-200}" rep="${3:-1}" run_id="tw$(date +%s)"
  log "실험: 워커 2 파드 (lease-mode=$mode, 작업 ${n}건, ${rep}회차)"
  # 경합을 실제로 만들려면 폴 간격을 줄여야 한다. 기본 500ms 로는 두 워커가 서로 다른 시각에
  # 폴해서 같은 행을 두고 겹치는 일이 거의 없다 - 처음 40건/500ms 로 돌렸을 때 세 모드가
  # 전부 같은 숫자를 냈고, 리스 경합은 40건에 1회였다. 조건을 올리지 않으면 이 실험은
  # 아무것도 가르지 못한다.
  kubectl -n "$NS" set env deploy/guard-worker \
    APP_RELAY_WORKER_LEASE_MODE="$mode" APP_RELAY_WORKER_TICK_MS=20 >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-worker --timeout=300s >/dev/null
  reset_queue

  local started ended left since
  # 로그 집계의 시작선. 부하를 넣기 직전에 찍어야 이 실행분만 센다.
  since=$(log_since)
  started=$(now_ms)
  enqueue "$run_id" "$n" ALWAYS_SUCCEED
  left=$(wait_drain "$run_id" 180)
  ended=$(now_ms)

  local succeeded attempts expected dup pods lease_conf attempt_conf
  succeeded=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status='SUCCEEDED'")
  attempts=$(sql "SELECT COUNT(*) FROM relay_attempt a JOIN relay_job j ON j.id=a.job_id WHERE j.idempotency_key LIKE 'lab-$run_id-%'")
  expected=$(sql "SELECT COALESCE(SUM(attempt_count),0) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%'")
  dup=$(sql "SELECT COUNT(*) FROM (SELECT job_id FROM relay_attempt a JOIN relay_job j ON j.id=a.job_id WHERE j.idempotency_key LIKE 'lab-$run_id-%' GROUP BY a.job_id, a.run, a.attempt_no HAVING COUNT(*)>1) d")
  pods=$(pod_work_counts "$since")
  lease_conf=$(conflict_counts lease "$since")
  attempt_conf=$(conflict_counts attempt "$since")

  emit "two-workers-$mode-r$rep" "$(cat <<JSON
{"leaseMode":"$mode","repeat":$rep,"jobs":$n,"succeeded":$succeeded,"unsettled":"$left",
 "attempts":$attempts,"attemptsExpected":$expected,"duplicateAttempts":$dup,
 "leaseConflicts":$lease_conf,"attemptConflicts":$attempt_conf,
 "elapsedMs":$((ended-started)),"tickMs":20,
 "perPodAttempts":"$(echo "$pods" | sed 's/ *$//')"}
JSON
)"
}

# ── 실험 2: 리스 층을 하나씩 걷어낸다 ────────────────────────────────────
# SKIP LOCKED 를 빼면 무엇이 달라지는가. 흔한 오해는 "중복이 난다"인데 그렇지 않다 -
# FOR UPDATE 는 여전히 상호배제를 지키고 **기다린다**. 잠금을 아예 빼야 비로소 둘이 같은 행을
# 집고, 그때 낙관적 락과 UNIQUE 제약이 마지막 방어선이 된다. 그 차이를 숫자로 가른다.
exp_lease_ablation() {
  # 모드마다 세 번씩 돈다. 한 번만 재면 경과 시간의 차이가 잡음인지 성질인지 말할 수 없다 -
  # 이 리포의 다른 실측(에이전트 A/B)에서 자기 분산을 함께 잰 것과 같은 이유다.
  for rep in 1 2 3; do
    for mode in SKIP_LOCKED FOR_UPDATE NONE; do
      exp_two_workers "$mode" 200 "$rep"
    done
  done
  kubectl -n "$NS" set env deploy/guard-worker APP_RELAY_WORKER_LEASE_MODE=SKIP_LOCKED >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-worker --timeout=300s >/dev/null
}

# ── 실험 3: 롤링 업데이트 중 무중단 ──────────────────────────────────────
# maxUnavailable=0 과 preStop 지연이 실제로 값을 하는지 본다. 배포하는 동안 요청을 계속 쏘고
# 실패를 센다. 0 이 아니면 "무중단"이라는 말을 쓰면 안 된다.
exp_rolling_update() {
  log "실험: 롤링 업데이트 중 요청 성공률"
  local ok=0 fail=0 codes="" pid
  ( while :; do
      if curl -sS -o /dev/null -m 2 "$GUARD_URL/actuator/health" 2>/dev/null; then echo ok; else echo fail; fi
      sleep 0.1
    done ) > /tmp/lab-rolling.txt &
  pid=$!
  kubectl -n "$NS" rollout restart deploy/guard-web >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-web --timeout=300s >/dev/null
  sleep 2
  kill "$pid" 2>/dev/null || true
  ok=$(grep -c '^ok$' /tmp/lab-rolling.txt || true)
  fail=$(grep -c '^fail$' /tmp/lab-rolling.txt || true)
  emit "rolling-update" "{\"requests\":$((ok+fail)),\"ok\":$ok,\"failed\":$fail,\"maxUnavailable\":0,\"preStopSleepSec\":5}"
}

# ── 실험 4: 파드를 죽인다 ────────────────────────────────────────────────
# 이 실험이 이 실험실의 이유다. 다른 데모(이중 승인 실험대)는 "크래시를 실제로 주입하지
# 않았다 - 멈춘 상태를 저장소에 직접 만들어 흉내 냈다"고 적어 두었다. 여기서는 진짜로 죽인다.
#
# 확인할 것: 시도를 실행하던 워커가 SIGKILL 되면 그 작업은 어떻게 되는가.
# 리스는 짧은 트랜잭션으로 이미 커밋돼 상태가 RUNNING 이고, 이 코드에는 **멈춘 리스를 회수하는
# 경로가 없다**(leaseReady 는 PENDING/RETRYING 만 집는다). 그래서 이 실험의 기대 결과는
# "잘 살아난다"가 아니라 **"영원히 RUNNING 으로 남는다"**이다. 구멍을 숫자로 남긴다.
exp_pod_kill() {
  local run_id="pk$(date +%s)" n="${1:-60}"
  log "실험: 리스를 쥔 순간 워커 전부 강제 종료 (작업 ${n}건)"

  # 창(window)이 어디인지 먼저 말해 둔다. 워커는 한 틱에 최대 LEASE_BATCH(4)건을 한
  # 트랜잭션으로 RUNNING 전이하고 **커밋한 뒤** 하나씩 실행한다. 그 사이에 프로세스가 죽으면
  # 작업은 RUNNING 으로 남고, 이 코드에는 그것을 회수하는 경로가 없다
  # (leaseReady 는 PENDING/RETRYING 만 집는다). 그래서 아무도 다시 집지 않는다.
  #
  # 실제 구간은 마이크로초라 밖에서 죽여 맞히는 것이 사실상 불가능하다 - 200건에 네 번
  # 죽여 한 건도 못 맞혔고, 3초로 넓혀도 kubectl 왕복 지연 때문에 계속 빗나갔다.
  # 30초로 넓혀야 비로소 확실히 맞는다. 죽이는 것은 여전히 외부의 강제 종료이고,
  # 넓힌 것은 겨냥할 창뿐이다 - 창의 존재 자체는 코드의 성질이다.
  kubectl -n "$NS" set env deploy/guard-worker \
    APP_RELAY_WORKER_TICK_MS=20 APP_RELAY_WORKER_LEASE_HOLD_MS=30000 >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-worker --timeout=300s >/dev/null

  reset_queue
  enqueue "$run_id" "$n" THIRD_TIME_LUCKY

  # 리스를 쥔 파드를 맞혀야 한다. 아무 때나 죽이면 방금 뜬 파드를 죽여 아무 일도 일어나지
  # 않는다(실제로 세 번 죽여 0건이 나왔다). 리스가 잡히는 데 한 틱이면 충분하고, 창이 30초라
  # 4초 뒤에는 확실히 붙잡고 있다. 그때 워커를 **전부** 죽인다.
  sleep 4
  local held
  held=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status='RUNNING'")
  local killed
  killed=$(kubectl -n "$NS" get pods -l role=worker -o name | tr '\n' ' ')
  kubectl -n "$NS" delete pods -l role=worker --force --grace-period=0 >/dev/null 2>&1 || true

  local left
  left=$(wait_drain "$run_id" 60)

  # 여기가 핵심이다. RUNNING 상태만 세면 "정체된 것"과 "지금 처리 중인 것"이 섞인다.
  # 워커를 전부 내린 뒤에 남은 RUNNING 은 **아무도 붙잡고 있지 않은** 것이므로 정체가 확실하다.
  kubectl -n "$NS" scale deploy/guard-worker --replicas=0 >/dev/null
  kubectl -n "$NS" wait --for=delete pod -l role=worker --timeout=120s >/dev/null 2>&1 || true
  local stranded settled
  stranded=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status='RUNNING'")
  settled=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status IN ('SUCCEEDED','DEAD_LETTER','CANCELED')")

  # 워커를 정상 설정으로 되살리고 넉넉히 기다린다. 회수 경로가 있다면 여기서 풀려야 한다.
  # "지금 안 풀렸다"와 "영원히 안 풀린다"는 다른 주장이라, 시간을 더 줘 보고 말한다.
  kubectl -n "$NS" set env deploy/guard-worker APP_RELAY_WORKER_LEASE_HOLD_MS=0 >/dev/null
  kubectl -n "$NS" scale deploy/guard-worker --replicas=2 >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-worker --timeout=300s >/dev/null
  sleep 45
  local still
  still=$(sql "SELECT COUNT(*) FROM relay_job WHERE idempotency_key LIKE 'lab-$run_id-%' AND status='RUNNING'")

  emit "pod-kill" "{\"jobs\":$n,\"heldAtKill\":$held,\"leaseHoldMs\":30000,\"settled\":$settled,
 \"strandedRunning\":$stranded,\"strandedAfterRestartAnd30s\":$still,\"unsettledAfterWait\":\"$left\",
 \"killedPods\":\"$(echo $killed | sed 's#pod/##g')\"}"
}

# ── 실험 5: readiness 프로브의 유무 ──────────────────────────────────────
# 프로브를 빼면 파드가 뜨자마자 엔드포인트에 들어간다. JVM 이 아직 기동 중인데 트래픽이 오면
# 연결 거부가 난다. "프로브가 필요하다"를 문장이 아니라 실패 건수로 말한다.
exp_readiness() {
  log "실험: readiness 프로브 없이 배포"
  local ok=0 fail=0 pid
  # 프로브를 지운 사본을 만들어 적용한다(원본 매니페스트는 건드리지 않는다).
  python3 - "$K8S/guard/web.yaml" > /tmp/lab-web-noprobe.yaml <<'PY'
import sys, re
doc = open(sys.argv[1], encoding='utf-8').read()
out, skip = [], False
for line in doc.split('\n'):
    if re.match(r'\s*(readinessProbe|startupProbe):', line):
        skip = True; continue
    if skip:
        if re.match(r'\s{10}\S', line) or re.match(r'\s{0,10}\S', line):
            skip = False
        else:
            continue
    out.append(line)
print('\n'.join(out))
PY
  ( while :; do
      if curl -sS -o /dev/null -m 2 "$GUARD_URL/actuator/health" 2>/dev/null; then echo ok; else echo fail; fi
      sleep 0.1
    done ) > /tmp/lab-readiness.txt &
  pid=$!
  kubectl apply -f /tmp/lab-web-noprobe.yaml >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-web --timeout=300s >/dev/null || true
  sleep 3
  kill "$pid" 2>/dev/null || true
  ok=$(grep -c '^ok$' /tmp/lab-readiness.txt || true)
  fail=$(grep -c '^fail$' /tmp/lab-readiness.txt || true)
  emit "readiness-off" "{\"requests\":$((ok+fail)),\"ok\":$ok,\"failed\":$fail}"
  # 원상 복구
  kubectl apply -f "$K8S/guard/web.yaml" >/dev/null
  kubectl -n "$NS" rollout status deploy/guard-web --timeout=300s >/dev/null
}

# ── 실험 0: 동시 기동 마이그레이션 ───────────────────────────────────────
# 계획에 없던 실험이다. 파드 둘을 동시에 올렸더니 Flyway 가 마이그레이션을 **번갈아** 적용했다
# (한 파드가 V4·V6·V8, 다른 파드가 V3·V5·V7). 락이 마이그레이션 하나 단위라 그렇다.
# 결과가 맞는지는 눈으로 볼 일이 아니라 세어야 하는 일이라 실험으로 남긴다.
exp_migration() {
  log "실험: 동시 기동 시 마이그레이션 정확히 1회"
  local applied dup failed
  applied=$(sql "SELECT COUNT(*) FROM flyway_schema_history")
  dup=$(sql "SELECT COUNT(*) FROM (SELECT version FROM flyway_schema_history WHERE version IS NOT NULL GROUP BY version HAVING COUNT(*)>1) d")
  failed=$(sql "SELECT COUNT(*) FROM flyway_schema_history WHERE success=0")
  emit "concurrent-migration" "{\"applied\":$applied,\"duplicateVersions\":$dup,\"failed\":$failed,\"startedPods\":2}"
}

# ── 결과 적재 ─────────────────────────────────────────────────────────────
# 산출물에 수집 시각을 넣지 않는다. 이 리포의 다른 실측 산출물과 같은 이유다 - 내용이 같은데
# 시각만 바뀌는 diff 가 매번 생기면, 파일이 변화를 알리는 신호가 아니라 잡음이 된다.
# 다만 여기는 결정적이지 않은 값(경과 시간, 파드 이름)이 섞이므로 그 사실을 파일에 적는다.
emit() {
  python3 - "$RESULTS" "$1" "$2" <<'PY'
import json, os, sys
path, name, payload = sys.argv[1], sys.argv[2], sys.argv[3]
doc = {"note": "kind 클러스터에서 실제로 돌린 실험 결과. 라이브 배포가 아니다(k8s/README.md). "
               "경과 시간과 파드 이름은 실행마다 달라진다 - 판정에 쓰는 값은 건수뿐이다.",
       "experiments": {}}
if os.path.exists(path):
    try: doc = json.load(open(path, encoding='utf-8'))
    except Exception: pass
doc.setdefault("experiments", {})[name] = json.loads(payload)
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, indent=2, sort_keys=True)
    f.write('\n')
print(f"  {name}: {payload.strip()}", file=sys.stderr)
PY
}

# 결과 파일은 **이 실행 하나**를 담는다. emit 이 기존 파일에 병합하므로, 도중에 실패하면
# 지난 실행(다른 사람의 기계일 수도 있는)의 항목이 남고 게이트가 그 낡은 숫자를 검사해
# 통과할 수 있다. 측정이 반쯤 돌았는데 초록불이 켜지는 것이 가장 나쁜 결과다.
measure() {
  preflight
  rm -f "$RESULTS"
  exp_migration
  exp_lease_ablation
  exp_rolling_update
  exp_pod_kill
  exp_readiness
  log "결과: $RESULTS"
  cat "$RESULTS"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  sql) sql "$2" ;;
  reset) reset_queue ;;
  measure) measure ;;
  exp) shift; "exp_$1" "${@:2}" ;;
  all) up && measure ;;
  *) sed -n '3,12p' "$0" >&2; exit 1 ;;
esac
