"""키워드 시그니처 기반 룰 분류기.

시그니처는 문서 서식 고유 문구(양식 명칭, 발급기관 상용구, 고정 필드 라벨)만 쓴다.
차주 개인정보(이름·주소·SSN 등)는 시그니처로 쓰지 않는다 — 근거 로그가 결과표에
실리므로, 결과물에 원문 개인정보가 새어 나가지 않게 하기 위한 원칙이다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

LABELS = ("URLA_1003", "INCOME_DOC", "CREDIT_REPORT", "TITLE_REPORT", "OTHER")

# 룰 확신 판정 기준: 최고 점수가 MIN 이상이고 2위와의 차이가 MARGIN 이상이어야 확정.
CONFIDENT_MIN_SCORE = 4
CONFIDENT_MIN_MARGIN = 3


@dataclass(frozen=True)
class Signature:
    label: str
    sig_id: str
    pattern: re.Pattern
    weight: int


def _sig(label: str, sig_id: str, pattern: str, weight: int, flags: int = re.IGNORECASE) -> Signature:
    return Signature(label, sig_id, re.compile(pattern, flags), weight)


SIGNATURES: list[Signature] = [
    # ── URLA_1003 (Form 1003 대출 신청서) ──────────────────────────────
    _sig("URLA_1003", "urla.title", r"uniform residential loan application", 4),
    _sig("URLA_1003", "urla.form65", r"freddie mac form 65", 4),
    _sig("URLA_1003", "urla.form1003", r"fannie mae form 1003", 4),
    _sig("URLA_1003", "urla.lender_loan_info", r"lender loan information", 3),
    _sig("URLA_1003", "urla.unmarried_addendum", r"unmarried addendum", 3),
    _sig("URLA_1003", "urla.demographic", r"demographic information (?:addendum|of borrower)", 3),
    _sig("URLA_1003", "urla.continuation", r"continuation sheet", 2),

    # ── CREDIT_REPORT (Tri-merge 신용 보고서) ──────────────────────────
    _sig("CREDIT_REPORT", "credit.xactus", r"xactus", 4),
    _sig("CREDIT_REPORT", "credit.reed_rd", r"370 reed r(?:oa)?d", 3),
    _sig("CREDIT_REPORT", "credit.repositories", r"repositories\s*:", 3),
    _sig("CREDIT_REPORT", "credit.score_disclosure", r"credit score disclosure", 3),
    # 연방 표준 고지문(Risk-Based Pricing Notice, 모델 서식 H-3)의 고정 제목
    _sig("CREDIT_REPORT", "credit.score_price_notice", r"your credit score and the price you pay for credit", 4),
    _sig("CREDIT_REPORT", "credit.understanding_score", r"understanding your credit score", 2),
    _sig("CREDIT_REPORT", "credit.fico", r"\bFICO\b", 1, 0),
    # 3대 신용정보사 단독 언급은 약한 신호(다른 서류에도 나올 수 있음).
    # 2개 이상 동시 등장 시 classify_text()에서 콤보 가점(+3)을 준다.
    _sig("CREDIT_REPORT", "credit.transunion", r"trans\s*union", 1),
    _sig("CREDIT_REPORT", "credit.experian", r"experian", 1),
    _sig("CREDIT_REPORT", "credit.equifax", r"equifax", 1),

    # ── TITLE_REPORT (Title Commitment / Preliminary Report) ─────────
    _sig("TITLE_REPORT", "title.commitment", r"commitment for title insurance", 4),
    # 체인 오브 타이틀(등기 이력 검색) 리포트도 타이틀 검색 산출물로 본다
    _sig("TITLE_REPORT", "title.chain_of_title", r"chain of title", 4),
    _sig("TITLE_REPORT", "title.prelim", r"preliminary (?:title )?report", 3),
    _sig("TITLE_REPORT", "title.fidelity", r"fidelity national title", 3),
    _sig("TITLE_REPORT", "title.company", r"chicago title|first american title|stewart title|old republic title", 3),
    _sig("TITLE_REPORT", "title.clta", r"\bCLTA\b", 2, 0),
    _sig("TITLE_REPORT", "title.alta", r"\bALTA\b", 2, 0),
    _sig("TITLE_REPORT", "title.officer", r"title officer", 2),
    _sig("TITLE_REPORT", "title.order_no", r"order no\.?\s*[:#]", 1),
    _sig("TITLE_REPORT", "title.schedule_b", r"schedule b", 1),
    _sig("TITLE_REPORT", "title.easement", r"easement", 1),
    _sig("TITLE_REPORT", "title.legal_desc", r"legal description", 1),
    # 지적도(plat map)는 타이틀 서류의 전형적 별첨 — 단, 감정평가서에도 실릴 수
    # 있어 단독으로는 확정하지 않는다(저신뢰 → LLM 폴백 대상).
    _sig("TITLE_REPORT", "title.plat_map", r"plat map", 2),

    # ── INCOME_DOC (급여명세·W-2·세금신고·P&L·VOE 등) ─────────────────
    _sig("INCOME_DOC", "income.wage_transcript", r"wage and income transcript", 4),
    # IRS 전사본(transcript) 계열 산출물에만 쓰이는 고정 보일러플레이트
    _sig("INCOME_DOC", "income.sensitive_taxpayer", r"contains sensitive taxpayer data", 4),
    # Experian 등 고용 검증(VOE) 리포트의 고정 필드
    _sig("INCOME_DOC", "income.voe_record", r"employment record available", 4),
    # 소득 검증 주문 결과물(4506-C 기반 W-2/1040 요약)의 필드
    _sig("INCOME_DOC", "income.irs_form_types", r"irs form types", 3),
    _sig("INCOME_DOC", "income.pnl", r"profit\s*(?:&|and)\s*loss", 4),
    _sig("INCOME_DOC", "income.voe", r"verification of employment", 4),
    _sig("INCOME_DOC", "income.w2_box", r"wages,\s*tips,?\s*(?:and\s*)?other comp", 3),
    _sig("INCOME_DOC", "income.f1040", r"form\s*1040", 3),
    _sig("INCOME_DOC", "income.paystub", r"pay\s*stub|earnings statement", 3),
    _sig("INCOME_DOC", "income.w2_form", r"form\s*w-?2\b", 2),
    _sig("INCOME_DOC", "income.ein", r"employer identification number", 2),
    _sig("INCOME_DOC", "income.gross_net", r"gross pay|net pay", 2),
    _sig("INCOME_DOC", "income.f1099", r"\b1099(?:-[A-Z]+)?\b", 1, 0),
    _sig("INCOME_DOC", "income.ytd", r"\bYTD\b", 1, 0),
    # CTEC = 캘리포니아 세무 신고 대리인 등록번호 — 세무 서류 서명란의 신호
    _sig("INCOME_DOC", "income.ctec", r"\bCTEC\b\s*#", 2, 0),

    # ── OTHER (대상 4유형 외 서류 중 서식이 알려진 것: 감정평가서 등) ──
    _sig("OTHER", "other.appraisal_form", r"uniform residential appraisal report", 4),
    _sig("OTHER", "other.appraisal_word", r"appraisal report", 3),
]

_BUREAUS = ("credit.transunion", "credit.experian", "credit.equifax")


@dataclass
class RuleResult:
    label: str | None       # None = 아무 시그니처도 안 맞음
    score: int
    margin: int             # 2위 라벨과의 점수 차
    confident: bool
    matched: list[str]      # 매칭된 시그니처 id 목록
    scores: dict[str, int]  # 라벨별 총점


def classify_text(
    text: str,
    min_score: int = CONFIDENT_MIN_SCORE,
    min_margin: int = CONFIDENT_MIN_MARGIN,
) -> RuleResult:
    """텍스트 한 페이지를 룰로 채점한다. 임계치는 애블레이션용으로 주입 가능."""
    scores: dict[str, int] = {label: 0 for label in LABELS}
    matched: list[str] = []

    for sig in SIGNATURES:
        if sig.pattern.search(text):
            scores[sig.label] += sig.weight
            matched.append(sig.sig_id)

    # 신용정보사 2곳 이상 동시 등장 → tri-merge 특유의 패턴이므로 가점
    bureau_hits = sum(1 for b in _BUREAUS if b in matched)
    if bureau_hits >= 2:
        scores["CREDIT_REPORT"] += 3
        matched.append("credit.bureau_combo")

    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    top_label, top_score = ranked[0]
    margin = top_score - ranked[1][1]

    if top_score == 0:
        return RuleResult(None, 0, 0, False, [], scores)

    confident = top_score >= min_score and margin >= min_margin
    return RuleResult(top_label, top_score, margin, confident, matched, scores)
