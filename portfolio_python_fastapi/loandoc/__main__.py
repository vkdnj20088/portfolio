"""loandoc CLI.

사용 예:
  # 분류 (룰 + LLM 폴백)
  python -m loandoc classify --pdf <셔플본.pdf> --out outputs/package_01

  # 분류 (LLM 없이 룰만)
  python -m loandoc classify --pdf <셔플본.pdf> --out outputs/package_01 --no-llm

  # package_01 자체 평가 (정답지 대조)
  python -m loandoc evaluate --shuffled <셔플본.pdf> \\
      --answer "URLA_1003=<1003.pdf>" --answer "CREDIT_REPORT=<credit.pdf>" \\
      --answer "INCOME_DOC=<income.pdf>" --answer "TITLE_REPORT=<title.pdf>" \\
      --results outputs/package_01/results.json --out outputs/package_01
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import load_dotenv


def cmd_classify(args: argparse.Namespace) -> int:
    # 인입 검증 게이트 — 무거운 모듈 임포트·파싱 전에 먼저 거른다
    from .ingest import validate_pdf_input

    for warning in validate_pdf_input(args.pdf):
        print(warning, file=sys.stderr)

    from .classify import classify_pdf
    from .grouping import group_runs, reconstruct_documents
    from .report import write_results
    from .viz import render_viz

    llm = None
    if not args.no_llm:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("오류: ANTHROPIC_API_KEY가 설정되지 않았다. "
                  "환경변수 또는 .env로 설정하거나 --no-llm으로 실행하라.",
                  file=sys.stderr)
            return 1
        from .llm import LlmClassifier

        llm = LlmClassifier(model=args.model, cache_dir=args.cache)

    records = classify_pdf(args.pdf, cache_dir=args.cache, llm=llm,
                           llm_all=args.llm_all)
    groups = group_runs(records)
    documents = reconstruct_documents(records)

    from .html_report import default_repro, report_filename, write_html_report

    pdf_name = Path(args.pdf).name
    write_results(args.out, pdf_name, records, groups, documents)
    render_viz(Path(args.out) / "viz.png", pdf_name, records)
    write_html_report(Path(args.out) / report_filename(args.out), pdf_name,
                      records, groups, documents, repro_cmd=default_repro(args.out))

    n_llm = sum(1 for r in records if r.llm_label)
    n_low = sum(1 for r in records if r.confidence == "low")
    print(f"완료: {len(records)}페이지 분류 → {args.out}")
    print(f"  판정 경로: 룰 확정 {sum(1 for r in records if r.stage == 'rule')}"
          f" / LLM {sum(1 for r in records if r.stage == 'llm')}"
          f" / 룰 저신뢰 추정 {sum(1 for r in records if r.stage == 'rule_lowconf')}")
    print(f"  LLM 호출 대상 {n_llm}페이지, 저신뢰 잔여 {n_low}페이지")
    if n_llm:
        tin = sum(r.llm_usage_input for r in records)
        tout = sum(r.llm_usage_output for r in records)
        print(f"  LLM 토큰 사용량: 입력 {tin:,} / 출력 {tout:,} (캐시 히트 포함 합계)")
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    from .ingest import validate_pdf_input

    for warning in validate_pdf_input(args.shuffled):
        print(warning, file=sys.stderr)

    from .classify import PageRecord
    from .evaluate import evaluate, write_eval
    from .groundtruth import build_ground_truth, save_ground_truth

    from .rules import LABELS

    answers = []
    for spec in args.answer:
        label, _, path = spec.partition("=")
        if not path:
            print(f"오류: --answer 형식은 LABEL=PATH 다: {spec}", file=sys.stderr)
            return 1
        if label not in LABELS:
            print(f"오류: 알 수 없는 라벨 '{label}' (허용: {', '.join(LABELS)})",
                  file=sys.stderr)
            return 1
        answers.append((label, Path(path).stem, Path(path)))

    gt = build_ground_truth(args.shuffled, answers, args.cache)
    save_ground_truth(gt, Path(args.out) / "gt.json")

    results = json.loads(Path(args.results).read_text(encoding="utf-8"))
    records = [
        PageRecord(
            page=p["page"], label=p["label"], stage=p["stage"],
            confidence=p["confidence"], text_chars=p["text_chars"],
            rule_label=p["rule"]["label"], rule_score=p["rule"]["score"],
            rule_margin=p["rule"]["margin"], rule_matched=p["rule"]["matched"],
            page_hint=tuple(p["page_hint"]) if p.get("page_hint") else None,
            urla_order=p.get("urla_order"),
            llm_label=(p["llm"] or {}).get("label"),
            llm_reason=(p["llm"] or {}).get("reason"),
        )
        for p in results["pages"]
    ]

    result = evaluate(records, gt)

    # 룰 확신 임계치 애블레이션(무비용) — eval.md 부록에 실린다
    from .evaluate import threshold_sweep
    from .extract import extract_pages

    result["threshold_sweep"] = threshold_sweep(
        extract_pages(args.shuffled, args.cache), gt
    )

    write_eval(args.out, result, gt)

    # 정답 대조 섹션을 포함해 HTML 리포트를 다시 쓴다 (classify 산출본 대체)
    from .grouping import group_runs, reconstruct_documents
    from .html_report import default_repro, report_filename, write_html_report

    groups = group_runs(records)
    documents = reconstruct_documents(records)
    write_html_report(Path(args.out) / report_filename(args.out), results["pdf"],
                      records, groups, documents, eval_result=result, gt=gt,
                      repro_cmd=default_repro(args.out))

    print(f"평가 완료: 정확도 {result['correct']}/{result['num_pages']} "
          f"({result['accuracy'] * 100:.1f}%) → {args.out}/eval.md")
    for e in result["errors"]:
        print(f"  오답 p{e['page']}: 정답 {e['truth']} vs 예측 {e['pred']} ({e['stage']})")
    return 0


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="loandoc", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_cls = sub.add_parser("classify", help="셔플 PDF 페이지 분류 + 그룹핑 + 결과물 생성")
    p_cls.add_argument("--pdf", required=True, help="입력 PDF 경로")
    p_cls.add_argument("--out", required=True, help="결과물 디렉토리")
    p_cls.add_argument("--cache", default="cache", help="로컬 캐시 디렉토리(기본 cache/)")
    p_cls.add_argument("--no-llm", action="store_true", help="LLM 폴백 없이 룰만 사용")
    p_cls.add_argument("--llm-all", action="store_true",
                       help="모든 페이지에 LLM 판정 기록(비교 실험용, 최종 라벨 정책은 동일)")
    p_cls.add_argument("--model", default="claude-sonnet-5", help="LLM 폴백 모델 ID")
    p_cls.set_defaults(func=cmd_classify)

    p_ev = sub.add_parser("evaluate", help="정답지 대조로 ground truth 생성 + 자체 평가")
    p_ev.add_argument("--shuffled", required=True, help="셔플본 PDF 경로")
    p_ev.add_argument("--answer", action="append", required=True,
                      help="정답 문서: LABEL=PATH (반복 지정)")
    p_ev.add_argument("--results", required=True, help="classify가 만든 results.json")
    p_ev.add_argument("--out", required=True, help="평가 결과 디렉토리")
    p_ev.add_argument("--cache", default="cache", help="로컬 캐시 디렉토리")
    p_ev.set_defaults(func=cmd_evaluate)

    args = parser.parse_args()
    from .ingest import IngestError

    try:
        return args.func(args)
    except IngestError as e:
        # 검증 거절(2)·파싱 실패(3)는 스택트레이스 없이 한 줄로 알리고 끝낸다
        print(f"입력 거절: {e}", file=sys.stderr)
        return e.exit_code


if __name__ == "__main__":
    sys.exit(main())
