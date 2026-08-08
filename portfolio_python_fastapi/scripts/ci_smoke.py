"""CI 스모크: 합성 픽스처로 룰-단독 파이프라인 E2E + 재현성 검사.

외부 데이터 없이 돌아야 하므로, 몇 페이지짜리 미니 PDF를 코드로 직접
조립한다(scripts/synth.py — 공개 표준 양식의 상용구만 삽입한 완전 창작물).
검사 항목:
  1) 인입 게이트: 위장 실행파일 거절(종료코드 2)
  2) classify 실행 → results.csv / results.json / report.html / viz.png 생성
  3) 페이지 라벨이 기대값과 일치 (룰 단독으로 4유형 확정)
  4) 같은 입력 2회 실행 산출물이 바이트 단위로 동일 (재현성)

사용법: python scripts/ci_smoke.py  (폴더 루트에서, 종료코드 0=성공)
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth import SMOKE_PAGES as FIXTURE_PAGES  # noqa: E402
from synth import build_pdf  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def run_classify(pdf: Path, out_dir: Path, cache: Path) -> None:
    r = subprocess.run(
        [sys.executable, "-m", "loandoc", "classify", "--pdf", str(pdf),
         "--out", str(out_dir), "--cache", str(cache), "--no-llm"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert r.returncode == 0, f"classify 실패(rc={r.returncode}): {r.stderr[-500:]}"


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="loandoc-smoke-") as td:
        base = Path(td)

        # 1) 인입 게이트: 위장 실행파일은 파싱 전에 거절돼야 한다
        fake = base / "disguised.pdf"
        fake.write_bytes(b"MZ\x90\x00\x03")
        r = subprocess.run(
            [sys.executable, "-m", "loandoc", "classify", "--pdf", str(fake),
             "--out", str(base / "x"), "--no-llm"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        assert r.returncode == 2, f"게이트 미동작(rc={r.returncode})"
        assert "PE/MZ" in r.stderr, "실행파일 시그니처 언급 누락"
        print("[1/4] 인입 게이트 거절 OK (rc=2, 시그니처 명시)")

        # 2) 합성 픽스처 E2E
        fixture = base / "fixture.pdf"
        fixture.write_bytes(build_pdf([t for t, _ in FIXTURE_PAGES]))
        out_a, out_b = base / "smoke_a", base / "smoke_b"
        run_classify(fixture, out_a, base / "cache")
        for name in ("results.csv", "results.json", "summary.md",
                     "report.html", "viz.png"):
            assert (out_a / name).is_file(), f"산출물 누락: {name}"
        print("[2/4] E2E 산출물 생성 OK (csv/json/md/html/png)")

        # 3) 라벨 검증 — 룰 단독으로 4유형 전부 고신뢰 확정이어야 한다
        data = json.loads((out_a / "results.json").read_text(encoding="utf-8"))
        got = [(p["label"], p["stage"]) for p in data["pages"]]
        want = [(label, "rule") for _, label in FIXTURE_PAGES]
        assert got == want, f"라벨/판정 불일치: {got}"
        assert data["pages"][2]["page_hint"] == [1, 2], "페이지 힌트 추출 실패"
        print("[3/4] 룰 분류 라벨 OK:", [label for label, _ in got])

        # 4) 재현성 — 같은 입력 2회 실행 산출물 바이트 동일
        run_classify(fixture, out_b, base / "cache")
        for name in ("results.csv", "results.json", "summary.md",
                     "report.html", "viz.png"):
            a = (out_a / name).read_bytes()
            b = (out_b / name).read_bytes()
            assert a == b, f"재현성 실패: {name} 바이트 불일치"
        print("[4/4] 재현성 OK (2회 실행 산출물 바이트 동일)")

    print("스모크 전체 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
