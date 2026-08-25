#!/usr/bin/env python3
"""실험 결과에서 무너지면 안 되는 성질만 골라 단언한다.

경과 시간이나 파드 이름처럼 실행마다 달라지는 값은 단언하지 않는다. 잡음이 게이트를 흔들면
사람이 게이트를 끄게 되고, 그러면 게이트가 있었다는 사실만 남는다.

여기 적힌 것은 전부 **이 실험이 증명하려는 것 자체**다:
  - 모든 작업이 종단에 닿았는가 (유실 없음)
  - 시도가 겹쳐 기록되지 않았는가 (이중 처리 없음)
  - 두 파드가 **둘 다** 일했는가 (한 파드가 다 한 것을 안전이라 부르지 않는다)
  - 동시 기동한 마이그레이션이 정확히 한 번씩 적용됐는가
"""

import json
import sys


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")
    FAILURES.append(msg)


FAILURES: list[str] = []


def main(path: str) -> int:
    doc = json.load(open(path, encoding="utf-8"))
    exps = doc.get("experiments", {})
    if not exps:
        print("실험 결과가 비어 있다 - 측정이 돌지 않았다")
        return 1

    # 반쯤 돌다 멈춘 결과에 초록불을 주지 않는다. emit 은 파일에 **병합**하므로 이 검사가
    # 없으면 지난 실행이 남긴 항목만으로 게이트가 통과할 수 있다 - 그때 초록불이 말하는 것은
    # 이번 실행이 아니라 지난 실행이다. 게이트가 무엇을 봤는지가 곧 게이트의 값어치다.
    missing = sorted({"concurrent-migration", "rolling-update", "pod-kill", "readiness-off"} - exps.keys())
    if missing:
        fail(f"실험이 빠졌다: {', '.join(missing)}")
    modes = {e.get("leaseMode") for n, e in exps.items() if n.startswith("two-workers-")}
    if len(modes) < 3:
        fail(f"리스 모드가 {len(modes)}종만 돌았다 - 층을 걷어낸 대조가 성립하지 않는다")

    for name, e in sorted(exps.items()):
        print(f"[{name}]")
        if name.startswith("two-workers-"):
            if e["succeeded"] != e["jobs"]:
                fail(f"{name}: 작업 {e['jobs']}건 중 {e['succeeded']}건만 종단에 닿았다")
            if e["duplicateAttempts"] != 0:
                fail(f"{name}: 겹쳐 기록된 시도 {e['duplicateAttempts']}건")
            if e["attempts"] != e["attemptsExpected"]:
                fail(f"{name}: 시도 {e['attempts']} != 기대 {e['attemptsExpected']}")
            counts = [int(p.split("=")[1]) for p in e["perPodAttempts"].split() if "=" in p]
            if len(counts) < 2:
                fail(f"{name}: 워커 파드가 {len(counts)}개다 - 다중 인스턴스 실험이 아니다")
            elif min(counts) == 0:
                fail(f"{name}: 한 파드가 한 일이 0건이다 - 분산됐다고 말할 수 없다")
        elif name == "concurrent-migration":
            if e["duplicateVersions"] != 0:
                fail(f"마이그레이션이 두 번 적용된 버전 {e['duplicateVersions']}개")
            if e["failed"] != 0:
                fail(f"실패한 마이그레이션 {e['failed']}건")
        elif name == "rolling-update":
            if e["requests"] == 0:
                fail("롤링 업데이트 중 요청을 한 건도 못 보냈다 - 측정이 성립하지 않는다")
            if e["failed"] != 0:
                fail(f"롤링 업데이트 중 실패 {e['failed']}건 - 무중단이 아니다")
        elif name == "pod-kill":
            # 여기는 "정체가 0이다"를 단언하지 않는다. 이 코드에는 멈춘 리스를 회수하는 경로가
            # 없어서, 파드를 죽이면 작업이 RUNNING 으로 남는 것이 **현재의 사실**이다.
            # 게이트가 단언할 것은 그 사실이 아니라 **측정이 성립했는가**다 - 죽인 시점에
            # 아무도 리스를 쥐고 있지 않았다면 그 실행은 아무것도 시험하지 않은 것이다.
            if e["heldAtKill"] == 0:
                fail("pod-kill: 죽인 시점에 리스를 쥔 작업이 0건이다 - 창을 못 맞혔다")
            if e["settled"] + e["strandedRunning"] > e["jobs"]:
                fail(f"pod-kill: 집계가 작업 수를 넘었다({e['settled']}+{e['strandedRunning']} > {e['jobs']})")
            if e["strandedRunning"] != e["strandedAfterRestartAnd30s"]:
                # 회수 경로가 생기면 이 값이 줄어든다. 줄어드는 것은 좋은 일이지만 README 의
                # 문장("아무도 다시 집지 않는다")이 낡았다는 뜻이라, 조용히 지나가지 않는다.
                fail(f"pod-kill: 정체 건수가 {e['strandedRunning']} → {e['strandedAfterRestartAnd30s']} 로 바뀌었다 "
                     "- 회수 경로가 생겼다면 문서를 고쳐야 한다")
        print(f"  {json.dumps(e, ensure_ascii=False)}")

    if FAILURES:
        print(f"\n불변식 {len(FAILURES)}건 위반")
        return 1
    print("\n불변식 전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "k8s/results/runs.json"))
