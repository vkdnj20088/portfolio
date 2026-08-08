"""분류 오케스트레이터: 룰 1차 → 저신뢰 페이지만 LLM 2차.

설계 원칙
- 룰이 확신하는 페이지는 LLM을 호출하지 않는다(비용·비결정성·감사가능성).
- LLM에는 룰 점수를 넘기지 않는다 — 독립 판정으로 앵커링을 피한다.
- 텍스트가 희박한 페이지는 렌더링 이미지를 비전 입력으로 보낸다.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .extract import extract_pages
from .llm import LlmClassifier, LlmResult
from .render import render_page_png
from .rules import RuleResult, classify_text

# 이보다 텍스트가 짧으면 LLM 폴백 시 이미지(비전)로 판정한다
VISION_TEXT_THRESHOLD = 400

# LLM 폴백 동시 호출 수. 판정 지연의 전부가 API 왕복이라 소규모 병렬로
# 충분하고, 워커 수만큼만 렌더 이미지를 동시에 들고 있으므로 메모리도
# 이 값으로 유계다(레이트리밋·메모리 사이의 보수값).
LLM_MAX_WORKERS = 4

_PAGE_HINT = re.compile(r"page\s*(\d+)\s*of\s*(\d+)", re.IGNORECASE)

# URLA 1003 양식의 구조 서수. 양식 구성 배열(차주 본문 Section 1–9 → 부속서
# → Lender Loan Information L1–L4)을 정규 순서로 쓴다 — "Page N of M"이 없는
# URLA 페이지의 순서 복원 보조 키다. 구성요소 배열은 양식 지식에 기반한
# 가정이므로, 재구성 결과물의 note에 휴리스틱임을 명시한다.
_URLA_SECTION = re.compile(r"section\s*([1-9])\s*[:.]", re.IGNORECASE)
_URLA_LENDER = re.compile(r"\bL([1-4])\s*[.:]\s*[A-Z]")
_URLA_COMPONENTS = (
    (re.compile(r"unmarried addendum", re.IGNORECASE), 10),
    (re.compile(r"continuation sheet", re.IGNORECASE), 11),
    (re.compile(r"lender loan information", re.IGNORECASE), 12),
    (re.compile(r"demographic information addendum", re.IGNORECASE), 16),
)


@dataclass
class PageRecord:
    page: int                      # 1기준
    label: str                     # 최종 라벨
    stage: str                     # "rule" | "llm" | "rule_lowconf"
    confidence: str                # "high" | "low"
    text_chars: int
    rule_label: str | None
    rule_score: int
    rule_margin: int
    rule_matched: list[str] = field(default_factory=list)
    page_hint: tuple[int, int] | None = None   # (n, m) — "Page N of M"
    urla_order: int | None = None              # URLA 양식 구조 서수(1–16) — 무힌트 순서 복원용
    llm_label: str | None = None
    llm_confidence: str | None = None
    llm_reason: str | None = None
    llm_model: str | None = None
    llm_input: str | None = None   # "text" | "image"
    llm_usage_input: int = 0
    llm_usage_output: int = 0
    group_id: int | None = None


def find_page_hint(text: str) -> tuple[int, int] | None:
    m = _PAGE_HINT.search(text)
    if not m:
        return None
    n, total = int(m.group(1)), int(m.group(2))
    if 1 <= n <= total:
        return (n, total)
    return None


def find_urla_order(text: str) -> int | None:
    """URLA 페이지의 양식 구조 서수를 뽑는다.

    Section N=1–9, Unmarried Addendum=10, Continuation Sheet=11,
    Lender Loan Information L1–L4=12–15, 단독 Demographic Addendum=16.
    섹션 번호가 있으면 최우선(섹션 제목과 부속서 명칭이 겹칠 수 있다 —
    예: Section 8이 Demographic Information이다).
    """
    secs = _URLA_SECTION.findall(text)
    if secs:
        return min(int(s) for s in secs)
    lender = _URLA_LENDER.findall(text)
    if lender:
        return 11 + min(int(n) for n in lender)
    for rx, ordinal in _URLA_COMPONENTS:
        if rx.search(text):
            return ordinal
    return None


def classify_pdf(
    pdf_path: str | Path,
    cache_dir: str | Path | None = "cache",
    llm: LlmClassifier | None = None,
    llm_all: bool = False,
    max_pages: int | None = None,
) -> list[PageRecord]:
    pdf_path = Path(pdf_path)
    texts = extract_pages(pdf_path, cache_dir, max_pages=max_pages)

    records: list[PageRecord] = []
    for i, text in enumerate(texts):
        rule = classify_text(text)
        records.append(
            PageRecord(
                page=i + 1,
                label=rule.label or "OTHER",
                stage="rule" if rule.confident else "rule_lowconf",
                confidence="high" if rule.confident else "low",
                text_chars=len(text.strip()),
                rule_label=rule.label,
                rule_score=rule.score,
                rule_margin=rule.margin,
                rule_matched=rule.matched,
                page_hint=find_page_hint(text),
            )
        )

    if llm is not None:
        targets = [r for r in records if llm_all or not (r.stage == "rule")]

        # 지연의 전부인 API 왕복만 병렬화한다. 비전 렌더링은 워커 안에서
        # 일어나지만 render_page_png 내부의 전역 락으로 직렬화된다(PDFium
        # 스레드 제약 — 렌더는 페이지당 ~100ms라 직렬이어도 병목이 아니다).
        # ex.map은 입력 순서대로 결과를 돌려주고 응답 캐시는 요청 해시별
        # 독립 파일이라, 병렬화해도 산출물 결정성은 그대로다.
        def _judge(r: PageRecord) -> tuple[str, LlmResult]:
            if r.text_chars < VISION_TEXT_THRESHOLD:
                return "image", llm.classify(image_png=render_page_png(pdf_path, r.page))
            return "text", llm.classify(text=texts[r.page - 1])

        if targets:
            with ThreadPoolExecutor(
                max_workers=min(LLM_MAX_WORKERS, len(targets))
            ) as ex:
                outcomes = list(ex.map(_judge, targets))
            for r, (kind, result) in zip(targets, outcomes):
                r.llm_input = kind
                r.llm_label = result.label
                r.llm_confidence = result.confidence
                r.llm_reason = result.reason
                r.llm_model = result.model
                r.llm_usage_input = result.usage_input
                r.llm_usage_output = result.usage_output
                # 최종 라벨 정책: 룰 확정 페이지는 룰을 유지(LLM은 기록만),
                # 저신뢰 페이지는 LLM 판정을 채택한다.
                if r.stage != "rule":
                    r.label = result.label
                    r.stage = "llm"
                    r.confidence = "high" if result.confidence == "high" else "low"

    # URLA 구조 키는 최종 라벨이 확정된 뒤 부여한다(LLM 폴백으로 URLA가 된
    # 페이지 포함). 내부 페이지 번호가 없는 URLA의 순서 복원에 쓰인다.
    for r in records:
        if r.label == "URLA_1003":
            r.urla_order = find_urla_order(texts[r.page - 1])

    return records
