"""분류 결과물 생성: results.csv / results.json / summary.md.

원칙: 결과물에는 서류 원문 텍스트·개인정보를 싣지 않는다. 근거는 시그니처 id와
LLM의 서식 문구 수준 설명만 기록한다.
"""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

from .classify import PageRecord
from .grouping import Group, LogicalDoc


def _md_cell(text: str) -> str:
    """마크다운 표 셀 안전화 — LLM 사유의 개행·파이프가 표 구조를 깨지 않게 한다."""
    return text.replace("\n", " ").replace("|", "\\|")


def build_payload(
    pdf_name: str,
    records: list[PageRecord],
    groups: list[Group],
    documents: list[LogicalDoc],
) -> dict:
    """results.json과 동일한 구조의 결과 딕셔너리 — CLI와 웹 서비스가 공유한다."""
    return {
        "pdf": pdf_name,
        "num_pages": len(records),
        "label_distribution": dict(sorted(Counter(r.label for r in records).items())),
        "stage_distribution": dict(sorted(Counter(r.stage for r in records).items())),
        "pages": [
            {
                "page": r.page,
                "label": r.label,
                "confidence": r.confidence,
                "stage": r.stage,
                "group_id": r.group_id,
                "rule": {
                    "label": r.rule_label,
                    "score": r.rule_score,
                    "margin": r.rule_margin,
                    "matched": r.rule_matched,
                },
                "page_hint": list(r.page_hint) if r.page_hint else None,
                "urla_order": r.urla_order,
                "llm": (
                    {
                        "label": r.llm_label,
                        "confidence": r.llm_confidence,
                        "reason": r.llm_reason,
                        "model": r.llm_model,
                        "input": r.llm_input,
                        "usage": {"input_tokens": r.llm_usage_input,
                                  "output_tokens": r.llm_usage_output},
                    }
                    if r.llm_label
                    else None
                ),
                "text_chars": r.text_chars,
            }
            for r in records
        ],
        "groups": [
            {"group_id": g.group_id, "label": g.label, "start": g.start,
             "end": g.end, "num_pages": len(g.pages)}
            for g in groups
        ],
        "documents": [
            {"doc_id": d.doc_id, "label": d.label, "pages": d.pages,
             "ordered_by_hint": d.ordered_by_hint, "note": d.note}
            for d in documents
        ],
    }


def write_results(
    out_dir: str | Path,
    pdf_name: str,
    records: list[PageRecord],
    groups: list[Group],
    documents: list[LogicalDoc],
) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # ── results.csv ──────────────────────────────────────────────
    with open(out / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            ["page", "label", "confidence", "stage", "group_id", "rule_label",
             "rule_score", "rule_margin", "evidence", "page_hint", "urla_order",
             "llm_label", "llm_confidence", "llm_input", "text_chars"]
        )
        for r in records:
            w.writerow([
                r.page, r.label, r.confidence, r.stage, r.group_id,
                r.rule_label or "", r.rule_score, r.rule_margin,
                "+".join(r.rule_matched),
                f"{r.page_hint[0]}/{r.page_hint[1]}" if r.page_hint else "",
                r.urla_order if r.urla_order is not None else "",
                r.llm_label or "", r.llm_confidence or "", r.llm_input or "",
                r.text_chars,
            ])

    # ── results.json ─────────────────────────────────────────────
    payload = build_payload(pdf_name, records, groups, documents)
    (out / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # ── summary.md (사람용 요약) ─────────────────────────────────
    lines: list[str] = []
    lines.append(f"# 분류 결과 요약 — {pdf_name}")
    lines.append("")
    lines.append(f"- 총 {len(records)}페이지")
    lines.append("")
    lines.append("## 유형별 분포")
    lines.append("")
    lines.append("| 유형 | 페이지 수 |")
    lines.append("|---|---|")
    for label, cnt in sorted(Counter(r.label for r in records).items()):
        lines.append(f"| {label} | {cnt} |")
    lines.append("")
    lines.append("## 페이지별 분류")
    lines.append("")
    lines.append("| 페이지 | 유형 | 판정 경로 | 신뢰도 | 근거 |")
    lines.append("|---|---|---|---|---|")
    stage_ko = {"rule": "룰 확정", "llm": "LLM 폴백", "rule_lowconf": "룰 추정(저신뢰)"}
    for r in records:
        if r.stage == "llm":
            ev = f"LLM({r.llm_input}): {_md_cell(r.llm_reason or '')}"
        else:
            ev = "+".join(r.rule_matched) or "-"
        lines.append(
            f"| {r.page} | {r.label} | {stage_ko[r.stage]} | {r.confidence} | {ev} |"
        )
    lines.append("")
    lines.append("## 문서 그룹 (연속 구간 기준)")
    lines.append("")
    lines.append("같은 유형이 연속된 구간을 하나의 문서로 본 결과다. "
                 "이 패키지는 페이지 단위로 완전히 섞여 있어 구간이 짧게 쪼개진다.")
    lines.append("")
    lines.append("| 그룹 | 유형 | 시작 | 끝 | 쪽수 |")
    lines.append("|---|---|---|---|---|")
    for g in groups:
        lines.append(f"| {g.group_id} | {g.label} | p{g.start} | p{g.end} | {len(g.pages)} |")
    lines.append("")
    lines.append("## 논리 문서 재구성 (부록)")
    lines.append("")
    lines.append("라벨과 문서 내부 페이지 번호(\"Page N of M\")로, 번호가 없는 "
                 "URLA는 양식 구조 키(Section 1–9 → 부속서 → Lender Loan "
                 "Information)로 원래 문서 단위·순서를 추정한 결과다. 어느 키도 "
                 "없는 페이지는 확정할 수 없어 별도 묶음으로 남겼다.")
    lines.append("")
    lines.append("| 문서 | 유형 | 페이지(원본 패키지 기준, 재구성 순서) | 비고 |")
    lines.append("|---|---|---|---|")
    for d in documents:
        pages = ", ".join(f"p{p}" for p in d.pages)
        lines.append(f"| {d.doc_id} | {d.label} | {pages} | {d.note} |")
    lines.append("")
    (out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
