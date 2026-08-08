"""package_01 자체 평가: 예측 vs ground truth.

GT는 groundtruth.py가 셔플본↔정답지 텍스트 대조로 만든 것이므로, 사람 라벨링
없이 페이지 단위 정답이 산술적으로 확정된다.
"""

from __future__ import annotations

import json
from pathlib import Path

from .classify import PageRecord
from .grouping import reconstruct_documents
from .rules import (CONFIDENT_MIN_MARGIN, CONFIDENT_MIN_SCORE, LABELS,
                    classify_text)


def threshold_sweep(
    texts: list[str],
    gt: dict,
    scores: tuple[int, ...] = (2, 3, 4, 5, 6),
    margins: tuple[int, ...] = (1, 2, 3, 4),
) -> list[dict]:
    """룰 확신 임계치(min_score/min_margin) 애블레이션.

    각 조합에 대해 "룰이 확정하는 페이지 수 / 그중 정답 수 / LLM 폴백
    대상 수"를 GT 기준으로 실측한다. 룰 재실행은 무비용이라 전 조합을
    그리드로 훑는다.
    """
    n = len(texts)
    rows = []
    for ms in scores:
        for mm in margins:
            confident = correct = 0
            for i, t in enumerate(texts):
                r = classify_text(t, min_score=ms, min_margin=mm)
                if r.confident:
                    confident += 1
                    if (r.label or "OTHER") == gt["pages"][str(i + 1)]["label"]:
                        correct += 1
            rows.append({
                "min_score": ms,
                "min_margin": mm,
                "confident_pages": confident,
                "confident_correct": correct,
                "confident_accuracy": round(correct / confident, 4) if confident else None,
                "fallback_pages": n - confident,
                "current": ms == CONFIDENT_MIN_SCORE and mm == CONFIDENT_MIN_MARGIN,
            })
    return rows


def check_reconstruction(records: list[PageRecord], gt: dict) -> list[dict]:
    """내부 페이지 번호 기반 재구성 결과를 GT의 (출처 문서, 출처 페이지)와 대조한다.

    검증 항목: 재구성 문서의 페이지들이 (1) 같은 출처 문서에 속하고
    (2) 재구성 순서가 출처 페이지 순서와 단조 일치하는가.
    """
    checks = []
    for doc in reconstruct_documents(records):
        if not doc.ordered_by_hint:
            continue
        srcs = [gt["pages"][str(p)] for p in doc.pages]
        same_doc = len({s["src_doc"] for s in srcs}) == 1
        monotonic = all(
            srcs[i]["src_page"] < srcs[i + 1]["src_page"] for i in range(len(srcs) - 1)
        )
        checks.append({
            "label": doc.label,
            "pages": doc.pages,
            "src_doc": srcs[0]["src_doc"] if same_doc else "혼재",
            "src_pages": [s["src_page"] for s in srcs],
            "same_source_doc": same_doc,
            "order_matches_source": monotonic,
        })
    return checks


def evaluate(records: list[PageRecord], gt: dict) -> dict:
    gt_pages = gt["pages"]
    n = len(records)
    assert n == gt["num_pages"], "페이지 수 불일치"

    errors = []
    confusion: dict[str, dict[str, int]] = {}
    per_label: dict[str, dict[str, int]] = {
        label: {"tp": 0, "fp": 0, "fn": 0} for label in LABELS
    }
    correct = 0
    stage_stats: dict[str, dict[str, int]] = {}

    for r in records:
        truth = gt_pages[str(r.page)]["label"]
        pred = r.label
        confusion.setdefault(truth, {}).setdefault(pred, 0)
        confusion[truth][pred] += 1
        st = stage_stats.setdefault(r.stage, {"total": 0, "correct": 0})
        st["total"] += 1
        if pred == truth:
            correct += 1
            st["correct"] += 1
            per_label[truth]["tp"] += 1
        else:
            per_label[pred]["fp"] += 1
            per_label[truth]["fn"] += 1
            errors.append({
                "page": r.page, "truth": truth, "pred": pred, "stage": r.stage,
                "evidence": r.rule_matched, "llm_reason": r.llm_reason,
                "src": f'{gt_pages[str(r.page)]["src_doc"]} p{gt_pages[str(r.page)]["src_page"]}',
            })

    metrics = {}
    for label in LABELS:
        tp, fp, fn = (per_label[label][k] for k in ("tp", "fp", "fn"))
        if tp + fp + fn == 0:
            continue
        p = tp / (tp + fp) if tp + fp else 0.0
        rcl = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * rcl / (p + rcl) if p + rcl else 0.0
        metrics[label] = {"precision": round(p, 4), "recall": round(rcl, 4),
                          "f1": round(f1, 4), "support": tp + fn}

    return {
        "num_pages": n,
        "correct": correct,
        "accuracy": round(correct / n, 4),
        "per_label": metrics,
        "confusion": {t: dict(sorted(ps.items())) for t, ps in sorted(confusion.items())},
        "stage_stats": stage_stats,
        "errors": errors,
        "reconstruction_checks": check_reconstruction(records, gt),
    }


def write_eval(out_dir: str | Path, result: dict, gt: dict) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "eval.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    num_docs = len({v["src_doc"] for v in gt["pages"].values()})
    match_kinds: dict[str, int] = {}
    for v in gt["pages"].values():
        k = v["match"].split(":")[0]
        match_kinds[k] = match_kinds.get(k, 0) + 1

    lines: list[str] = []
    lines.append("# package_01 자체 평가")
    lines.append("")
    lines.append("## 측정 방법")
    lines.append("")
    lines.append(f"셔플본 {gt['num_pages']}페이지와 정답 문서 {num_docs}종"
                 f"(합 {gt['num_pages']}페이지)의 추출 텍스트를 정규화(소문자화·공백 "
                 "접기)해 1:1 대조해 페이지 단위 ground truth를 만들었다. "
                 "사람 라벨링은 개입하지 않았다.")
    lines.append("")
    lines.append(f"- GT 매칭 방식 분포: {match_kinds} (exact=완전 일치, fuzzy=유사도 매칭)")
    if set(match_kinds) == {"exact"}:
        lines.append("- 전 페이지가 완전 일치로 매칭되어 GT가 산술적으로 확정된다.")
    else:
        lines.append("- 유사도 매칭이 사용된 페이지는 GT에 불확실성이 있을 수 있다"
                     "(gt.json의 match 필드 참고).")
    lines.append("")
    lines.append("## 결과")
    lines.append("")
    lines.append(f"- **페이지 분류 정확도: {result['correct']}/{result['num_pages']} "
                 f"({result['accuracy'] * 100:.1f}%)**")
    lines.append("")
    lines.append("### 판정 경로별")
    lines.append("")
    lines.append("| 경로 | 페이지 수 | 정답 수 |")
    lines.append("|---|---|---|")
    stage_ko = {"rule": "룰 확정", "llm": "LLM 폴백", "rule_lowconf": "룰 추정(저신뢰)"}
    for stage, st in sorted(result["stage_stats"].items()):
        lines.append(f"| {stage_ko.get(stage, stage)} | {st['total']} | {st['correct']} |")
    lines.append("")
    lines.append("### 유형별 precision / recall / F1")
    lines.append("")
    lines.append("| 유형 | precision | recall | F1 | 페이지 수 |")
    lines.append("|---|---|---|---|---|")
    for label, m in result["per_label"].items():
        lines.append(f"| {label} | {m['precision']:.3f} | {m['recall']:.3f} "
                     f"| {m['f1']:.3f} | {m['support']} |")
    lines.append("")
    lines.append("### 혼동 행렬 (행=정답, 열=예측)")
    lines.append("")
    labels_present = sorted(result["confusion"].keys())
    lines.append("| 정답\\예측 | " + " | ".join(labels_present) + " |")
    lines.append("|---" * (len(labels_present) + 1) + "|")
    for t in labels_present:
        row = [str(result["confusion"][t].get(p, 0)) for p in labels_present]
        lines.append(f"| {t} | " + " | ".join(row) + " |")
    lines.append("")
    lines.append("## 오답 사례")
    lines.append("")
    if not result["errors"]:
        lines.append("오답 없음.")
    else:
        lines.append("| 페이지 | 정답 | 예측 | 경로 | 출처 |")
        lines.append("|---|---|---|---|---|")
        for e in result["errors"]:
            lines.append(f"| p{e['page']} | {e['truth']} | {e['pred']} "
                         f"| {e['stage']} | {e['src']} |")
    lines.append("")
    sweep = result.get("threshold_sweep")
    if sweep:
        n = result["num_pages"]
        cur = next(r for r in sweep if r["current"])
        loosest = min(sweep, key=lambda r: (r["fallback_pages"], r["min_score"], r["min_margin"]))
        all_perfect = all(r["confident_accuracy"] in (None, 1.0) for r in sweep)
        lines.append("## 부록: 룰 확신 임계치 애블레이션")
        lines.append("")
        lines.append("룰 확정 기준(최소 점수 min_score, 2위와의 최소 격차 min_margin)을 "
                     "그리드로 훑어 \"룰이 확정하는 페이지 수 ↔ LLM 폴백 대상 수\" "
                     "트레이드오프를 실측했다. 룰 재실행은 무비용이다.")
        lines.append("")
        lines.append("| min_score | min_margin | 룰 확정 | 확정 중 정답 | 확정 정확도 | LLM 폴백 대상 | |")
        lines.append("|---|---|---|---|---|---|---|")
        for r in sweep:
            acc = f"{r['confident_accuracy']:.3f}" if r["confident_accuracy"] is not None else "-"
            mark = "◀ 현재값" if r["current"] else ""
            lines.append(f"| {r['min_score']} | {r['min_margin']} | {r['confident_pages']}p "
                         f"| {r['confident_correct']}p | {acc} | {r['fallback_pages']}p | {mark} |")
        lines.append("")
        if all_perfect:
            lines.append(f"이 패키지에서는 어떤 조합에서도 확정 오답이 나오지 않아 정확도 축이 "
                         f"평평하고, 임계치의 실효는 폴백 비용(LLM 호출 수)과 미지 입력에 대한 "
                         f"보수성 사이의 선택이다. 현재값({cur['min_score']}/{cur['min_margin']})은 "
                         f"확정 {cur['confident_pages']}p·폴백 {cur['fallback_pages']}p 지점으로, "
                         f"가장 느슨한 조합(확정 {loosest['confident_pages']}p·폴백 "
                         f"{loosest['fallback_pages']}p)보다 폴백이 "
                         f"{cur['fallback_pages'] - loosest['fallback_pages']}p 많지만, 약신호 "
                         f"한두 개로 유형을 확정하지 않는 보수적 여유를 둔 선택이다. 시그니처가 "
                         f"이 두 패키지의 발급기관 어휘에 맞춰져 있는 만큼, 새 벤더 서류에서 "
                         f"안전 마진은 낮은 폴백 수보다 가치가 크다고 봤다.")
        else:
            worst = min((r for r in sweep if r["confident_accuracy"] is not None),
                        key=lambda r: r["confident_accuracy"])
            lines.append(f"느슨한 조합에서는 확정 오답이 발생한다(최저 확정 정확도 "
                         f"{worst['confident_accuracy']:.3f} @ {worst['min_score']}/"
                         f"{worst['min_margin']}). 현재값({cur['min_score']}/{cur['min_margin']})은 "
                         f"확정 정확도를 유지하면서 폴백 {cur['fallback_pages']}p를 감수하는 지점이다.")
        lines.append("")
    if result["reconstruction_checks"]:
        lines.append("## 부록: 논리 문서 재구성 검증")
        lines.append("")
        lines.append("내부 페이지 번호(\"Page N of M\") 또는 URLA 양식 구조 키로 "
                     "재구성한 문서를 GT의 출처 정보와 대조한 결과다.")
        lines.append("")
        lines.append("| 유형 | 재구성 페이지 수 | 출처 문서 | 단일 문서 여부 | 순서 일치 여부 |")
        lines.append("|---|---|---|---|---|")
        for c in result["reconstruction_checks"]:
            lines.append(
                f"| {c['label']} | {len(c['pages'])} | {c['src_doc']} "
                f"| {'예' if c['same_source_doc'] else '아니오'} "
                f"| {'예' if c['order_matches_source'] else '아니오'} |"
            )
        lines.append("")
    (out / "eval.md").write_text("\n".join(lines), encoding="utf-8")
