"""HTML 리포트 생성 단위 테스트 (외부 데이터·네트워크 불필요)."""

import unittest

from loandoc.classify import PageRecord
from loandoc.grouping import group_runs, reconstruct_documents
from loandoc.html_report import render_html_report, report_filename


def _rec(page, label, stage="rule", reason=None):
    return PageRecord(
        page=page, label=label, stage=stage,
        confidence="high" if stage == "rule" else "low",
        text_chars=100, rule_label=label, rule_score=5, rule_margin=5,
        rule_matched=["sig.a", "sig.b"], llm_label=label if stage == "llm" else None,
        llm_reason=reason,
    )


class TestHtmlReport(unittest.TestCase):
    def _render(self, records, **kwargs):
        groups = group_runs(records)
        documents = reconstruct_documents(records)
        return render_html_report("test.pdf", records, groups, documents,
                                  version="loandoc test", **kwargs)

    def test_sections_and_type_colors(self):
        records = [_rec(1, "URLA_1003"), _rec(2, "CREDIT_REPORT"),
                   _rec(3, "URLA_1003")]
        out = self._render(records)
        for marker in ("문서 분류 리포트", "문서 그루핑 타임라인", "문서 단위 그룹",
                       "페이지 단위 분류 결과", "재현"):
            self.assertIn(marker, out)
        # 유형색은 CSS 클래스로 한 번 정의되어 표·타임라인·범례가 공유한다
        self.assertIn(".t-URLA_1003{background:#c9f24e", out)
        self.assertNotIn("정답 대조", out)  # eval 없는 리포트

    def test_llm_reason_is_escaped(self):
        records = [_rec(1, "OTHER", stage="llm",
                        reason='<script>alert("x")</script> & more')]
        out = self._render(records)
        self.assertNotIn("<script>alert", out)
        self.assertIn("&lt;script&gt;", out)

    def test_eval_section_with_errors(self):
        records = [_rec(1, "URLA_1003"), _rec(2, "INCOME_DOC")]
        eval_result = {
            "num_pages": 2, "correct": 1, "accuracy": 0.5,
            "stage_stats": {"rule": {"total": 2, "correct": 1}},
            "errors": [{"page": 2, "truth": "TITLE_REPORT", "pred": "INCOME_DOC",
                        "stage": "rule", "src": "title p1"}],
        }
        gt = {"num_pages": 2, "pages": {
            "1": {"label": "URLA_1003", "src_doc": "u", "src_page": 1, "match": "exact"},
            "2": {"label": "TITLE_REPORT", "src_doc": "t", "src_page": 1, "match": "exact"},
        }}
        out = self._render(records, eval_result=eval_result, gt=gt)
        self.assertIn("정답 대조", out)
        self.assertIn("오답", out)
        self.assertIn("정답 TITLE_REPORT", out)  # 틀린 행에 정답 병기

    def test_report_filename(self):
        self.assertEqual(report_filename("outputs/package_01"), "report_01.html")
        self.assertEqual(report_filename("outputs/package_02"), "report_02.html")
        self.assertEqual(report_filename("outputs/foo"), "report.html")


if __name__ == "__main__":
    unittest.main()
