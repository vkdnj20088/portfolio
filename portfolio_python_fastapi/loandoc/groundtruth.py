"""셔플본 페이지 ↔ 정답 문서 페이지 기계 대조로 ground truth를 만든다.

같은 추출기로 뽑은 텍스트를 정규화해 비교하므로, 대부분 완전 일치로 붙는다.
완전 일치가 안 되는 페이지만 유사도(difflib) 폴백으로 1:1 매칭한다.
결과에는 라벨·출처 문서·출처 페이지만 담기고 원문 텍스트는 담기지 않는다.
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path

from .extract import extract_pages, normalize_text

FUZZY_MIN_RATIO = 0.85


def build_ground_truth(
    shuffled_pdf: str | Path,
    answers: list[tuple[str, str, Path]],  # (label, doc_name, pdf_path)
    cache_dir: str | Path | None = None,
) -> dict:
    """반환: {"pages": {셔플페이지(1기준): {label, src_doc, src_page, match}}, ...}"""
    shuffled = [normalize_text(t) for t in extract_pages(shuffled_pdf, cache_dir)]

    # 정답지 전 페이지 풀 구성
    pool: list[dict] = []  # {label, doc, page, text}
    for label, doc_name, path in answers:
        for i, t in enumerate(extract_pages(path, cache_dir)):
            pool.append({"label": label, "doc": doc_name, "page": i + 1,
                         "text": normalize_text(t)})

    if len(shuffled) != len(pool):
        raise ValueError(f"페이지 수 불일치: 셔플본 {len(shuffled)}p vs 정답지 합 {len(pool)}p")

    result: dict[int, dict] = {}
    used: set[int] = set()

    # 1차: 정규화 텍스트 완전 일치 (동일 텍스트 중복 페이지는 순서대로 소진)
    for si, stext in enumerate(shuffled):
        for pi, cand in enumerate(pool):
            if pi in used:
                continue
            if stext == cand["text"]:
                result[si + 1] = {"label": cand["label"], "src_doc": cand["doc"],
                                  "src_page": cand["page"], "match": "exact"}
                used.add(pi)
                break

    # 2차: 남은 페이지를 유사도 최고 순으로 1:1 매칭 (결정적 순서로 탐색)
    remaining_s = [si for si in range(len(shuffled)) if si + 1 not in result]
    pairs: list[tuple[float, int, int]] = []
    for si in remaining_s:
        for pi, cand in enumerate(pool):
            if pi in used:
                continue
            # autojunk=False: 긴 텍스트에서 빈출 문자를 junk 처리해 비율이
            # 왜곡되는 것을 방지(문서 텍스트는 공백·숫자 빈도가 높다)
            ratio = difflib.SequenceMatcher(
                None, shuffled[si], cand["text"], autojunk=False
            ).ratio()
            pairs.append((ratio, si, pi))
    pairs.sort(key=lambda t: (-t[0], t[1], t[2]))
    for ratio, si, pi in pairs:
        if si + 1 in result or pi in used:
            continue
        if ratio < FUZZY_MIN_RATIO:
            continue
        cand = pool[pi]
        result[si + 1] = {"label": cand["label"], "src_doc": cand["doc"],
                          "src_page": cand["page"], "match": f"fuzzy:{ratio:.3f}"}
        used.add(pi)

    unmatched = [si + 1 for si in range(len(shuffled)) if si + 1 not in result]
    if unmatched:
        raise ValueError(f"매칭 실패 페이지: {unmatched} (유사도 {FUZZY_MIN_RATIO} 미만)")

    return {
        "shuffled_pdf": Path(shuffled_pdf).name,
        "num_pages": len(shuffled),
        "pages": {str(k): result[k] for k in sorted(result)},
    }


def save_ground_truth(gt: dict, out_path: str | Path) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(gt, ensure_ascii=False, indent=2), encoding="utf-8")
