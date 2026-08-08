"""문서 단위 그룹핑.

두 가지 뷰를 만든다.
1) 연속 구간(run) 그룹 — 같은 라벨이 연속된 구간을
   하나의 문서로 보고 시작/끝 페이지를 식별한다.
2) 논리 문서 재구성 — 완전 페이지 셔플에서는 run이 대부분 길이 1이라 정보가
   없으므로, 라벨 + 문서 내부 페이지 번호("Page N of M")를 이용해 원래 문서
   단위를 추정한다. 내부 번호가 없어도 URLA처럼 양식 구조가 고정된 문서는
   구조 서수(classify.find_urla_order)를 보조 키로 써서 순서를 복원한다.
   둘 다 없는 페이지는 등장 순서를 유지한 별도 묶음으로 남기고 그 사실을
   note에 기록한다(휴리스틱임을 명시).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .classify import PageRecord


@dataclass
class Group:
    group_id: int
    label: str
    start: int
    end: int
    pages: list[int] = field(default_factory=list)


@dataclass
class LogicalDoc:
    doc_id: int
    label: str
    pages: list[int]           # 셔플본 페이지 번호, 재구성 순서
    ordered_by_hint: bool
    note: str


def group_runs(records: list[PageRecord]) -> list[Group]:
    """같은 라벨 연속 구간을 그룹으로 묶고 record.group_id를 채운다."""
    groups: list[Group] = []
    for r in records:
        if groups and groups[-1].label == r.label and groups[-1].end == r.page - 1:
            groups[-1].end = r.page
            groups[-1].pages.append(r.page)
        else:
            groups.append(Group(len(groups) + 1, r.label, r.page, r.page, [r.page]))
        r.group_id = groups[-1].group_id
    return groups


def reconstruct_documents(records: list[PageRecord]) -> list[LogicalDoc]:
    docs: list[LogicalDoc] = []
    labels_in_order: list[str] = []
    for r in records:
        if r.label not in labels_in_order:
            labels_in_order.append(r.label)

    for label in labels_in_order:
        pages = [r for r in records if r.label == label]
        hinted = [r for r in pages if r.page_hint]
        unhinted = [r for r in pages if not r.page_hint]

        # 내부 페이지 번호가 있는 페이지: 총쪽수(m)별로 문서 후보를 만든다.
        by_total: dict[int, list[PageRecord]] = {}
        for r in hinted:
            by_total.setdefault(r.page_hint[1], []).append(r)

        for total in sorted(by_total):
            group = by_total[total]
            # 같은 (라벨, 총쪽수)에서 페이지 번호 n이 중복되면 문서가 여러 개다.
            # k번째 중복은 k번째 문서로 — 등장 순서 기반의 결정적 짝짓기이며,
            # 실제 소속 문서와 다를 수 있다(내용 대조 없이는 확정 불가).
            copies: dict[int, int] = {}
            split: dict[int, list[PageRecord]] = {}
            for r in sorted(group, key=lambda r: r.page):
                n = r.page_hint[0]
                idx = copies.get(n, 0)
                copies[n] = idx + 1
                split.setdefault(idx, []).append(r)
            multi = len(split) > 1
            for idx in sorted(split):
                members = sorted(split[idx], key=lambda r: r.page_hint[0])
                note = f'내부 번호 "Page n of {total}" 기준 재구성'
                if multi:
                    note += " — 동일 번호 중복으로 문서 분리(등장 순서 짝짓기, 불확실)"
                if len(members) < total:
                    note += f" — {total}쪽 중 {len(members)}쪽만 확인"
                docs.append(
                    LogicalDoc(0, label, [r.page for r in members], True, note)
                )

        # 내부 번호가 없어도 양식 구조 서수가 있으면(URLA) 그 순서로 복원한다.
        structured = [r for r in unhinted if r.urla_order is not None]
        rest = [r for r in unhinted if r.urla_order is None]

        if structured:
            members = sorted(structured, key=lambda r: (r.urla_order, r.page))
            dup = len({r.urla_order for r in members}) < len(members)
            note = ("URLA 양식 구조 키 기준 재구성(Section 1–9 → 부속서 → "
                    "Lender Loan Information) — 구성요소 배열을 정규 순서로 "
                    "가정한 휴리스틱")
            if dup:
                note += " — 동일 구조 키 중복(등장 순서 짝짓기, 불확실)"
            docs.append(
                LogicalDoc(0, label, [r.page for r in members], True, note)
            )

        if rest:
            docs.append(
                LogicalDoc(
                    0,
                    label,
                    [r.page for r in rest],
                    False,
                    "내부 페이지 번호 없음 — 패키지 등장 순서 유지"
                    + (" (정렬된 묶음과 같은 문서일 수 있음)"
                       if hinted or structured else ""),
                )
            )

    for i, d in enumerate(docs):
        d.doc_id = i + 1
    return docs
