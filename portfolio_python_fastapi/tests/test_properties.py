"""hypothesis 속성 테스트 — 예시가 아니라 성질을 검사한다.

결정성: derandomize 프로파일을 고정해 같은 케이스가 항상 같은 순서로
생성된다(재현성 원칙 유지). hypothesis 미설치 환경(requirements.txt만
설치)에서는 자동 스킵된다 — 전체 실행은 requirements-dev.txt 기준.
"""

import unittest

try:
    from hypothesis import given, settings, strategies as st

    settings.register_profile("deterministic", derandomize=True, deadline=None)
    settings.load_profile("deterministic")
    HAVE_HYPOTHESIS = True
except ImportError:
    HAVE_HYPOTHESIS = False

from loandoc.classify import PageRecord
from loandoc.extract import normalize_text
from loandoc.grouping import group_runs
from loandoc.rules import LABELS, classify_text


def _rec(page: int, label: str) -> PageRecord:
    return PageRecord(
        page=page, label=label, stage="rule", confidence="high", text_chars=1,
        rule_label=label, rule_score=5, rule_margin=5,
    )


@unittest.skipUnless(HAVE_HYPOTHESIS, "hypothesis 미설치 — requirements-dev.txt 필요")
class TestProperties(unittest.TestCase):
    @given(st.text(max_size=500))
    def test_normalize_is_idempotent(self, text):
        once = normalize_text(text)
        self.assertEqual(normalize_text(once), once)

    @given(st.text(max_size=2000))
    def test_classify_never_crashes_and_label_is_valid(self, text):
        r = classify_text(text)
        self.assertTrue(r.label is None or r.label in LABELS)
        self.assertEqual(set(r.scores), set(LABELS))
        self.assertGreaterEqual(r.score, 0)
        if r.label is None:
            self.assertFalse(r.confident)

    @given(st.lists(st.sampled_from(sorted(LABELS)), min_size=1, max_size=60))
    def test_runs_partition_pages_in_order(self, labels):
        records = [_rec(i + 1, label) for i, label in enumerate(labels)]
        groups = group_runs(records)
        # (1) 전체 페이지를 빠짐·중복 없이 순서대로 분할한다
        flattened = [p for g in groups for p in g.pages]
        self.assertEqual(flattened, list(range(1, len(labels) + 1)))
        for g in groups:
            # (2) run 내부는 단일 라벨·연속 구간이다
            self.assertEqual(g.pages, list(range(g.start, g.end + 1)))
            self.assertEqual({records[p - 1].label for p in g.pages}, {g.label})
        # (3) run은 최대 구간이다 — 인접 run의 라벨은 항상 다르다
        for a, b in zip(groups, groups[1:]):
            self.assertNotEqual(a.label, b.label)


if __name__ == "__main__":
    unittest.main()
