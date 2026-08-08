"""핵심 로직 단위 테스트 (표준 라이브러리 unittest, 외부 데이터 불필요).

실행: python -m unittest discover -s tests -v
"""

import unittest

from loandoc.classify import PageRecord, find_page_hint
from loandoc.evaluate import check_reconstruction, evaluate
from loandoc.extract import normalize_text
from loandoc.grouping import group_runs, reconstruct_documents
from loandoc.rules import classify_text


def _rec(page, label, hint=None):
    return PageRecord(
        page=page, label=label, stage="rule", confidence="high", text_chars=100,
        rule_label=label, rule_score=5, rule_margin=5, rule_matched=[],
        page_hint=hint,
    )


class TestRules(unittest.TestCase):
    def test_urla_signatures(self):
        r = classify_text(
            "Uniform Residential Loan Application ... "
            "Freddie Mac Form 65 · Fannie Mae Form 1003"
        )
        self.assertEqual(r.label, "URLA_1003")
        self.assertTrue(r.confident)

    def test_credit_bureau_combo(self):
        # 신용정보사 1곳 단독은 저신뢰, 2곳 이상 동시 등장 시 콤보 가점으로 확정
        weak = classify_text("reported by Experian only")
        self.assertFalse(weak.confident)
        combo = classify_text("TransUnion and Experian and Equifax data")
        self.assertEqual(combo.label, "CREDIT_REPORT")
        self.assertIn("credit.bureau_combo", combo.matched)
        self.assertTrue(combo.confident)

    def test_title_commitment(self):
        r = classify_text("COMMITMENT FOR TITLE INSURANCE issued by ...")
        self.assertEqual(r.label, "TITLE_REPORT")
        self.assertTrue(r.confident)

    def test_income_transcript_boilerplate(self):
        r = classify_text("This Product Contains Sensitive Taxpayer Data")
        self.assertEqual(r.label, "INCOME_DOC")
        self.assertTrue(r.confident)

    def test_vendor_name_is_not_a_doc_type(self):
        # Corelogic/ICE는 신용·소득·평가를 모두 취급하는 벤더명 — 그 자체로는
        # 문서 유형 신호가 아니어야 한다(과거 오분류 원인, 회귀 방지)
        r = classify_text("Prepared by Corelogic for ICE Mortgage Technology")
        self.assertFalse(r.confident)

    def test_no_signal(self):
        r = classify_text("lorem ipsum dolor sit amet")
        self.assertIsNone(r.label)
        self.assertFalse(r.confident)

    def test_plat_map_low_confidence(self):
        # 지적도는 타이틀 방향 약신호일 뿐 단독 확정은 금지(감정평가서에도 실림)
        r = classify_text("[ Plat map removed ]")
        self.assertEqual(r.label, "TITLE_REPORT")
        self.assertFalse(r.confident)


class TestPageHint(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(find_page_hint("Page 3 of 11"), (3, 11))
        self.assertEqual(find_page_hint("PAGE 2 OF 2"), (2, 2))
        self.assertIsNone(find_page_hint("no page marker here"))
        self.assertIsNone(find_page_hint("Page 9 of 2"))  # n > m 은 무효


class TestGrouping(unittest.TestCase):
    def test_runs(self):
        records = [_rec(1, "A"), _rec(2, "A"), _rec(3, "B"), _rec(4, "A")]
        groups = group_runs(records)
        self.assertEqual([(g.label, g.start, g.end) for g in groups],
                         [("A", 1, 2), ("B", 3, 3), ("A", 4, 4)])
        self.assertEqual([r.group_id for r in records], [1, 1, 2, 3])

    def test_reconstruction_orders_by_hint(self):
        records = [
            _rec(1, "CREDIT_REPORT", (3, 3)),
            _rec(2, "CREDIT_REPORT", (1, 3)),
            _rec(3, "CREDIT_REPORT", (2, 3)),
        ]
        docs = reconstruct_documents(records)
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].pages, [2, 3, 1])  # 내부 번호 1,2,3 순
        self.assertTrue(docs[0].ordered_by_hint)

    def test_reconstruction_splits_duplicate_numbers(self):
        # "Page 1 of 2"가 두 번 나오면 2쪽짜리 문서가 2개라는 뜻
        records = [
            _rec(1, "INCOME_DOC", (1, 2)),
            _rec(2, "INCOME_DOC", (1, 2)),
            _rec(3, "INCOME_DOC", (2, 2)),
            _rec(4, "INCOME_DOC", (2, 2)),
        ]
        docs = reconstruct_documents(records)
        self.assertEqual(len(docs), 2)
        self.assertEqual(docs[0].pages, [1, 3])
        self.assertEqual(docs[1].pages, [2, 4])

    def test_unhinted_pages_kept_separately(self):
        records = [_rec(1, "TITLE_REPORT", (1, 2)), _rec(2, "TITLE_REPORT"),
                   _rec(3, "TITLE_REPORT", (2, 2))]
        docs = reconstruct_documents(records)
        self.assertEqual(len(docs), 2)
        self.assertTrue(docs[0].ordered_by_hint)
        self.assertFalse(docs[1].ordered_by_hint)
        self.assertEqual(docs[1].pages, [2])

    def test_reconstruction_orders_urla_by_structure_key(self):
        # 내부 페이지 번호가 없어도 URLA 구조 서수로 순서를 복원한다
        records = [_rec(p, "URLA_1003") for p in (1, 2, 3, 4)]
        for r, order in zip(records, (11, 1, 15, 10)):
            r.urla_order = order
        docs = reconstruct_documents(records)
        self.assertEqual(len(docs), 1)
        self.assertTrue(docs[0].ordered_by_hint)
        self.assertEqual(docs[0].pages, [2, 4, 1, 3])  # 서수 1, 10, 11, 15 순
        self.assertIn("구조 키", docs[0].note)

    def test_urla_pages_without_key_stay_separate(self):
        records = [_rec(1, "URLA_1003"), _rec(2, "URLA_1003")]
        records[0].urla_order = 1
        docs = reconstruct_documents(records)
        self.assertEqual(len(docs), 2)
        self.assertEqual(docs[0].pages, [1])
        self.assertFalse(docs[1].ordered_by_hint)


class TestUrlaOrderKey(unittest.TestCase):
    def test_section_pages(self):
        from loandoc.classify import find_urla_order

        self.assertEqual(find_urla_order("Section 1: Borrower Information"), 1)
        # 한 페이지에 섹션이 여럿이면 가장 앞 섹션이 페이지의 위치다
        self.assertEqual(
            find_urla_order("Section 3: Financial ... Section 4: Loan ..."), 3)

    def test_lender_and_component_pages(self):
        from loandoc.classify import find_urla_order

        self.assertEqual(find_urla_order("L1. Property and Loan Information"), 12)
        self.assertEqual(find_urla_order("L4. Qualifying the Borrower"), 15)
        self.assertEqual(find_urla_order("Unmarried Addendum to the ..."), 10)
        self.assertEqual(find_urla_order("Continuation Sheet / URLA"), 11)
        self.assertIsNone(find_urla_order("no structural markers here"))

    def test_section_number_beats_component_title(self):
        # Section 8 제목이 Demographic Information이라 부속서 명칭과 겹친다 —
        # 섹션 번호가 있으면 섹션이 우선이어야 한다
        from loandoc.classify import find_urla_order

        text = "Section 8: Demographic Information ... Demographic Information Addendum"
        self.assertEqual(find_urla_order(text), 8)


class TestEvaluate(unittest.TestCase):
    @staticmethod
    def _gt(entries):
        # entries: {page: (label, src_doc, src_page)}
        return {
            "num_pages": len(entries),
            "pages": {
                str(p): {"label": lb, "src_doc": d, "src_page": sp, "match": "exact"}
                for p, (lb, d, sp) in entries.items()
            },
        }

    def test_accuracy_and_errors(self):
        records = [
            _rec(1, "URLA_1003"),
            _rec(2, "CREDIT_REPORT"),
            _rec(3, "INCOME_DOC"),  # 오답이 되도록 GT는 TITLE
        ]
        gt = self._gt({
            1: ("URLA_1003", "urla", 1),
            2: ("CREDIT_REPORT", "credit", 1),
            3: ("TITLE_REPORT", "title", 1),
        })
        result = evaluate(records, gt)
        self.assertEqual(result["correct"], 2)
        self.assertAlmostEqual(result["accuracy"], round(2 / 3, 4))
        self.assertEqual(len(result["errors"]), 1)
        err = result["errors"][0]
        self.assertEqual((err["page"], err["truth"], err["pred"]),
                         (3, "TITLE_REPORT", "INCOME_DOC"))
        self.assertEqual(result["confusion"]["TITLE_REPORT"]["INCOME_DOC"], 1)
        # 오답 페이지의 유형별 지표: INCOME은 fp, TITLE은 fn
        self.assertEqual(result["per_label"]["INCOME_DOC"]["precision"], 0.0)
        self.assertEqual(result["per_label"]["TITLE_REPORT"]["recall"], 0.0)

    def test_reconstruction_check_detects_order(self):
        records = [
            _rec(1, "CREDIT_REPORT", (2, 2)),
            _rec(2, "CREDIT_REPORT", (1, 2)),
        ]
        gt_good = self._gt({1: ("CREDIT_REPORT", "credit", 5),
                            2: ("CREDIT_REPORT", "credit", 4)})
        ok = check_reconstruction(records, gt_good)[0]
        self.assertTrue(ok["same_source_doc"])
        self.assertTrue(ok["order_matches_source"])  # 재구성 p2→p1 = src 4→5

        gt_bad = self._gt({1: ("CREDIT_REPORT", "credit", 4),
                           2: ("CREDIT_REPORT", "credit", 5)})
        bad = check_reconstruction(records, gt_bad)[0]
        self.assertFalse(bad["order_matches_source"])


class TestNormalize(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_text("  A  B\n\nC  "), "a b c")


class TestLlmFallbackParallel(unittest.TestCase):
    def test_parallel_fallback_pairs_results_to_pages(self):
        # 병렬 폴백에서 결과가 페이지 순서대로, 각 페이지 자신의 입력과
        # 짝지어지는지 검증한다(API 불필요 — 스텁 분류기). 페이지 크기를
        # 서로 다르게 만들어 렌더 이미지 폭으로 어느 페이지의 판정인지
        # 식별한다.
        import io as _io
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace

        from pypdf import PdfWriter

        from loandoc.classify import classify_pdf

        sizes = [(612, 792), (500, 500), (300, 600)]
        w = PdfWriter()
        for pw, ph in sizes:
            w.add_blank_page(width=pw, height=ph)

        class Stub:
            def classify(self, text=None, image_png=None):
                from PIL import Image

                width = Image.open(_io.BytesIO(image_png)).size[0]
                return SimpleNamespace(
                    label="OTHER", confidence="high", reason=f"w={width}",
                    model="stub", usage_input=0, usage_output=0,
                )

        with tempfile.TemporaryDirectory() as td:
            pdf = Path(td) / "t.pdf"
            buf = _io.BytesIO()
            w.write(buf)
            pdf.write_bytes(buf.getvalue())
            records = classify_pdf(pdf, cache_dir=None, llm=Stub())

        # 빈 페이지 3장 전부 저신뢰 → 비전 폴백 대상
        self.assertEqual([r.stage for r in records], ["llm"] * 3)
        self.assertEqual([r.llm_input for r in records], ["image"] * 3)
        got = [int(r.llm_reason.split("=")[1]) for r in records]
        for got_w, (page_w, _) in zip(got, sizes):
            self.assertLessEqual(abs(got_w - round(page_w * 2.0)), 2)


class TestReportSafety(unittest.TestCase):
    def test_summary_md_escapes_llm_reason_table_cells(self):
        # LLM 사유의 개행·파이프가 summary.md 표 구조를 깨지 않아야 한다
        import tempfile
        from pathlib import Path

        from loandoc.report import write_results

        r = _rec(1, "OTHER")
        r.stage = "llm"
        r.llm_label = "OTHER"
        r.llm_input = "text"
        r.llm_reason = "generic|header\nsecond line"
        groups = group_runs([r])
        docs = reconstruct_documents([r])
        with tempfile.TemporaryDirectory() as td:
            write_results(td, "t.pdf", [r], groups, docs)
            text = (Path(td) / "summary.md").read_text(encoding="utf-8")
        self.assertIn(r"generic\|header second line", text)
        self.assertNotIn("generic|header", text)


if __name__ == "__main__":
    unittest.main()
