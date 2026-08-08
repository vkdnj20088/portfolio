"""데모 자산 생성: 합성 패키지 PDF + 완성형 정적 리포트.

산출물 두 개를 demo/ 에 쓴다(둘 다 저장소에 커밋한다 — 방문자는 생성 과정
없이 바로 본다):
  demo/demo_package.pdf  16페이지 합성 패키지. 데모 페이지의 "샘플 내려받기"
                         가 이 파일이라, 대출 서류가 있을 리 없는 방문자도
                         업로드 데모를 바로 돌려볼 수 있다.
  demo/report.html       위 패키지를 파이프라인(룰 단독)으로 돌린 자기완결
                         리포트. 업로드 데모가 요약 화면이라면 이쪽은 산출물의
                         완성형이다.

전 과정이 결정적이다: 픽스처는 타임스탬프·난수가 없고(synth.build_pdf),
파이프라인 룰 레이어도 결정적이라 재실행 산출물이 바이트까지 같다.
리포트의 파이프라인 버전 표기는 git 커밋에 의존하므로 --version 으로 고정한다.

사용법: python scripts/make_demo_package.py   (폴더 루트에서)
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from synth import DEMO_PAGES, build_pdf  # noqa: E402

from loandoc.classify import classify_pdf  # noqa: E402
from loandoc.grouping import group_runs, reconstruct_documents  # noqa: E402
from loandoc.html_report import write_html_report  # noqa: E402


def main() -> int:
    demo_dir = ROOT / "demo"
    demo_dir.mkdir(exist_ok=True)

    pdf_path = demo_dir / "demo_package.pdf"
    pdf_path.write_bytes(build_pdf([t for t, _, _ in DEMO_PAGES]))

    # 룰 단독(LLM 없음) — 배포 데모와 같은 모드로 만든 리포트여야 한다.
    records = classify_pdf(pdf_path, cache_dir=None, llm=None)

    # 자기 검증: 픽스처가 의도한 라벨·판정 단계와 정확히 일치해야 한다.
    got = [(r.label, r.stage) for r in records]
    want = [(label, stage) for _, label, stage in DEMO_PAGES]
    if got != want:
        for i, (g, w) in enumerate(zip(got, want), start=1):
            if g != w:
                print(f"불일치 p{i}: got={g} want={w}", file=sys.stderr)
        return 1

    groups = group_runs(records)
    documents = reconstruct_documents(records)
    write_html_report(
        demo_dir / "report.html", pdf_path.name, records, groups, documents,
        repro_cmd="python scripts/make_demo_package.py",
        # 커밋 해시를 넣으면 "이 파일을 재생성한 커밋"과 "파일이 담긴 커밋"이
        # 항상 한 칸 어긋난다(생성 시점엔 아직 커밋 전이므로). 고정 표기를 쓴다.
        version="synthetic-demo",
    )

    n_low = sum(1 for r in records if r.stage == "rule_lowconf")
    print(f"demo/demo_package.pdf {pdf_path.stat().st_size:,}B / "
          f"demo/report.html {(demo_dir / 'report.html').stat().st_size:,}B")
    print(f"{len(records)}페이지: 룰 확정 {len(records) - n_low} / 저신뢰 {n_low}, "
          f"논리 문서 {len(documents)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
