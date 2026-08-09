"""동봉 샘플에 대한 **실제 LLM 판정**을 받아 캐시로 굳힌다(커밋 대상).

왜 이걸 커밋하나: 공개 배포에는 API 키를 두지 않는다. 그렇다고 LLM 폴백이 무엇을 하는지
보여 주지 못하면, 이 데모의 절반(룰이 못 정한 페이지를 AI 가 맡는다)은 말로만 남는다.
그래서 **키를 가진 사람이 한 번 호출한 응답**을 요청 해시별 JSON 으로 저장해 커밋한다.
키 없는 서버는 그것을 그대로 재생하고(LlmClassifier(cache_only=True)), 캐시에 없는 입력
(방문자가 올린 PDF)은 룰 판정으로 남는다.

정직성 경계 — 화면이 이렇게 말한다:
  - 동봉 샘플: "실제 Claude 응답을 캐시에서 재생(서버에 키 없음)"
  - 그 외 입력: "커밋된 캐시에 없어 룰 단독으로 판정했습니다"
즉 캐시는 결정성 장치이자 산출물이지, 실시간 호출인 척하는 장치가 아니다.

저장되는 것은 판정 결과(label/confidence/reason/model/토큰수)뿐이다. reason 은 서식 문구만
쓰도록 프롬프트가 강제하고(llm.SYSTEM_PROMPT), 입력 자체는 합성 픽스처라 개인정보가 없다.

사용법(키가 있는 로컬에서 1회):
    export ANTHROPIC_API_KEY=sk-ant-...
    python scripts/make_llm_cache.py
    git add demo/llm-cache && git commit
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from loandoc.classify import classify_pdf  # noqa: E402
from loandoc.llm import LlmClassifier  # noqa: E402


def main() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY 가 필요합니다 - 이 스크립트만 실제 API 를 부릅니다.",
              file=sys.stderr)
        return 2

    demo_dir = ROOT / "demo"
    pdf_path = demo_dir / "demo_package.pdf"
    if not pdf_path.is_file():
        print("demo/demo_package.pdf 가 없습니다 - make_demo_package.py 를 먼저 실행하세요.",
              file=sys.stderr)
        return 1

    # 캐시 루트를 demo/llm-cache 로 준다. LlmClassifier 가 그 아래 llm/ 을 만든다.
    cache_root = demo_dir / "llm-cache"
    llm = LlmClassifier(cache_dir=cache_root)

    # 배포 화면과 **같은 경로**로 돌린다. 여기서만 다른 코드를 타면 캐시 키가 어긋나
    # 정작 배포에서는 전부 캐시 미스가 된다(요청 해시가 입력 바이트에 걸려 있다).
    records = classify_pdf(pdf_path, cache_dir=None, llm=llm)

    judged = [r for r in records if r.stage == "llm"]
    files = sorted((cache_root / "llm").glob("*.json")) if (cache_root / "llm").is_dir() else []
    print(f"{len(records)}페이지 중 LLM 판정 {len(judged)}면 / 캐시 파일 {len(files)}개")
    for r in judged:
        print(f"  p{r.page}: {r.llm_label} ({r.llm_confidence}) [{r.llm_input}] {r.llm_reason}")
    if not files:
        print("캐시가 비었습니다 - 룰이 모든 페이지를 확정했다면 정상입니다.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
