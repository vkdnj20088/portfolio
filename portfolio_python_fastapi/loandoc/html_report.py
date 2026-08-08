"""자기완결형 정적 HTML 리포트 생성.

분류 결과표·시각화의 대표 산출물. 서버·빌드 없이
file:// 로 바로 열리도록 CSS는 전부 인라인이고, 웹폰트는 실패 시 시스템 폰트로
폴백된다(오프라인에서도 레이아웃 유지).

디자인 규칙(요지)
- --ink 배경 + 64px 격자. 격자 위 구분선은 --line-strong(격자와 같은 색이면 묻힘).
- 제목 serif / 데이터·숫자 mono / 본문 sans, 한글 word-break: keep-all.
- 라임(--acid)은 kicker 라벨과 대표 유형(URLA_1003) 계열에만 쓴다.
- 유형 구분색은 색각이상 검증기(dataviz validate_palette, all-pairs·dark)로
  CVD 분리·정상시력 플로어를 통과시킨 뮤트 5색. 저채도 설계라 모든 마크에
  유형 문자를 병기해 색 단독 식별을 배제한다(OTHER 저대비 릴리프 포함).
- 결과물에는 서류 원문 덤프·페이지 이미지를 넣지 않는다(근거는 시그니처 id와
  LLM 판정 요지 한 줄까지만).
"""

from __future__ import annotations

import html
import re
import subprocess
from pathlib import Path

from . import __version__
from .classify import PageRecord
from .grouping import Group, LogicalDoc

LABEL_COLORS = {
    "URLA_1003": "#c9f24e",     # acid — 대표 유형
    "INCOME_DOC": "#dcae66",    # ochre
    "CREDIT_REPORT": "#7aa9d1", # slate blue
    "TITLE_REPORT": "#b97785",  # dusty rose
    "OTHER": "#565a4f",         # dark moss gray
}
# 어두운 OTHER 셀만 밝은 글자(대비 확보), 나머지는 잉크색 글자
LABEL_TEXT = {"OTHER": "var(--paper)"}
LABEL_INITIAL = {
    "URLA_1003": "U", "INCOME_DOC": "I", "CREDIT_REPORT": "C",
    "TITLE_REPORT": "T", "OTHER": "O",
}

FONTS_HREF = ("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600"
              "&family=Gowun+Batang:wght@400&family=IBM+Plex+Sans+KR:wght@400;500;600"
              "&family=JetBrains+Mono:wght@400;500;700&display=swap")

_STAGE_TAG = {
    "rule": '<span class="tag">RULE</span>',
    "llm": '<span class="tag tag--ai">AI</span>',
    "rule_lowconf": '<span class="tag tag--low">RULE·저신뢰</span>',
}


def esc(v: object) -> str:
    return html.escape(str(v), quote=True)


def report_filename(out_dir: str | Path) -> str:
    m = re.search(r"(\d+)$", Path(out_dir).name)
    return f"report_{m.group(1)}.html" if m else "report.html"


def default_repro(out_dir: str | Path) -> str:
    return "python -m loandoc classify --pdf <입력.pdf> --out <출력 디렉토리>"


def pipeline_version() -> str:
    """재현 식별자: 패키지 버전 + git 커밋 해시(가능할 때)."""
    root = Path(__file__).resolve().parent.parent
    try:
        head = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=3,
        )
        if head.returncode == 0:
            dirty = subprocess.run(
                ["git", "-C", str(root), "status", "--porcelain"],
                capture_output=True, text=True, timeout=3,
            )
            mark = "+" if dirty.stdout.strip() else ""
            return f"loandoc {__version__} · {head.stdout.strip()}{mark}"
    except Exception:
        pass
    return f"loandoc {__version__}"


def _cell_style(label: str) -> str:
    return (f"background:{LABEL_COLORS[label]};"
            f"color:{LABEL_TEXT.get(label, 'var(--ink)')}")


def _chip(label: str) -> str:
    return f'<i class="chip" style="background:{LABEL_COLORS[label]}"></i>'


def _timeline(records: list[PageRecord], groups: list[Group]) -> str:
    segs = []
    for g in groups:
        cells = []
        for p in g.pages:
            r = records[p - 1]
            marker = ""
            if r.stage == "llm":
                marker = " m"
            elif r.stage == "rule_lowconf":
                marker = " m m--low"
            cells.append(
                f'<span class="cell{marker}" style="{_cell_style(r.label)}" '
                f'title="p{p} · {esc(r.label)} · {esc(r.stage)}">'
                f"{LABEL_INITIAL[r.label]}<i>{p}</i></span>"
            )
        segs.append(f'<span class="seg">{"".join(cells)}</span>')
    return f'<div class="tlwrap"><div class="tl">{"".join(segs)}</div></div>'


def _legend(records: list[PageRecord]) -> str:
    counts: dict[str, int] = {}
    for r in records:
        counts[r.label] = counts.get(r.label, 0) + 1
    # 범례는 항상 고정 순서 — 유형↔색 대응이 리포트 간에 흔들리지 않게 한다
    items = [
        f'<span>{_chip(label)}{LABEL_INITIAL[label]} · {esc(label)} '
        f'<span class="cnt">{counts[label]}p</span></span>'
        for label in LABEL_COLORS if label in counts
    ]
    items.append('<span><span class="dot dot--ai"></span>AI 판정</span>')
    items.append('<span><span class="dot dot--low"></span>룰 저신뢰 추정</span>')
    return f'<div class="legend">{"".join(items)}</div>'


def _groups_table(groups: list[Group]) -> str:
    rows = []
    for g in groups:
        span = f"p{g.start}" if g.start == g.end else f"p{g.start}–p{g.end}"
        rows.append(
            f"<tr><td class=\"mono dim\">{g.group_id}</td>"
            f"<td>{_chip(g.label)}<span class=\"mono\">{esc(g.label)}</span></td>"
            f"<td class=\"mono\">{span}</td>"
            f"<td class=\"mono dim\">{len(g.pages)}</td></tr>"
        )
    return (
        '<table><thead><tr><th>#</th><th>유형</th><th>시작–끝</th><th>쪽수</th>'
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def _documents_table(documents: list[LogicalDoc]) -> str:
    rows = []
    for d in documents:
        pages = ", ".join(f"p{p}" for p in d.pages)
        rows.append(
            f"<tr><td class=\"mono dim\">{d.doc_id}</td>"
            f"<td>{_chip(d.label)}<span class=\"mono\">{esc(d.label)}</span></td>"
            f"<td class=\"mono ev\" title=\"{esc(pages)}\">{esc(pages)}</td>"
            f"<td class=\"note\">{esc(d.note)}</td></tr>"
        )
    return (
        '<table><thead><tr><th>문서</th><th>유형</th><th>페이지(재구성 순서)</th>'
        f"<th>비고</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def _evidence(r: PageRecord) -> str:
    if r.stage == "llm" and r.llm_reason:
        text = r.llm_reason
    else:
        text = "+".join(r.rule_matched) or "—"
    short = text if len(text) <= 110 else text[:107] + "…"
    return f'<span class="ev" title="{esc(text)}">{esc(short)}</span>'


def _pages_table(records: list[PageRecord], error_pages: dict[int, dict]) -> str:
    rows = []
    for r in records:
        err = error_pages.get(r.page)
        cls = ' class="err"' if err else ""
        page_cell = f"p{r.page}"
        if err:
            page_cell += ' <span class="tag tag--err">오답</span>'
        label_cell = f'{_chip(r.label)}<span class="mono">{esc(r.label)}</span>'
        if err:
            label_cell += (f'<span class="truth">정답 {esc(err["truth"])}</span>')
        rows.append(
            f"<tr{cls}><td class=\"mono\">{page_cell}</td>"
            f"<td>{label_cell}</td>"
            f"<td>{_STAGE_TAG[r.stage]}</td>"
            f"<td class=\"mono dim\">{esc(r.confidence)}</td>"
            f"<td>{_evidence(r)}</td></tr>"
        )
    return (
        '<table><thead><tr><th>페이지</th><th>판정 유형</th><th>판정</th>'
        f"<th>신뢰도</th><th>근거</th></tr></thead><tbody>{''.join(rows)}</tbody></table>"
    )


def _eval_section(eval_result: dict, gt: dict) -> str:
    acc = eval_result["accuracy"] * 100
    acc_str = f"{acc:.1f}".rstrip("0").rstrip(".")
    match_kinds: dict[str, int] = {}
    for v in gt["pages"].values():
        k = v["match"].split(":")[0]
        match_kinds[k] = match_kinds.get(k, 0) + 1
    gt_note = ("정답 문서와 섞인 패키지의 추출 텍스트를 정규화해 1:1 기계 대조한 "
               "ground truth 기준입니다"
               + (" (전 페이지 완전 일치 매칭)." if set(match_kinds) == {"exact"}
                  else f" (매칭 분포: {esc(match_kinds)})."))

    stage_ko = {"rule": "룰 확정", "llm": "AI 폴백", "rule_lowconf": "룰 저신뢰 추정"}
    stage_rows = "".join(
        f"<tr><td>{_STAGE_TAG.get(stage, esc(stage))}</td>"
        f"<td class=\"mono\">{esc(stage_ko.get(stage, stage))}</td>"
        f"<td class=\"mono dim\">{st['total']}p</td>"
        f"<td class=\"mono dim\">{st['correct']}p</td></tr>"
        for stage, st in sorted(eval_result["stage_stats"].items())
    )

    if eval_result["errors"]:
        err_rows = "".join(
            f"<tr class=\"err\"><td class=\"mono\">p{e['page']}</td>"
            f"<td>{_chip(e['truth'])}<span class=\"mono\">{esc(e['truth'])}</span></td>"
            f"<td>{_chip(e['pred'])}<span class=\"mono\">{esc(e['pred'])}</span></td>"
            f"<td class=\"mono dim\">{esc(e['stage'])}</td>"
            f"<td class=\"note\">{esc(e['src'])}</td></tr>"
            for e in eval_result["errors"]
        )
        errors_html = (
            '<p class="caption">틀린 페이지 목록 — 페이지 표에서도 오답 태그로 '
            "표시됩니다.</p>"
            '<table><thead><tr><th>페이지</th><th>정답</th><th>예측</th>'
            f"<th>판정</th><th>출처</th></tr></thead><tbody>{err_rows}</tbody></table>"
        )
    else:
        errors_html = ('<p class="ok mono">오답 없음 — '
                       f'{eval_result["num_pages"]}페이지 전원 일치.</p>')

    return f"""
<section>
  <div class="kicker">Ground Truth</div>
  <h2>정답 대조</h2>
  <p class="caption">{gt_note}</p>
  <div class="evalgrid">
    <div class="stat">
      <div class="num">{eval_result["correct"]}<span class="unit">/{eval_result["num_pages"]}</span></div>
      <div class="lab">일치 페이지</div>
    </div>
    <div class="stat">
      <div class="num">{acc_str}<span class="unit">%</span></div>
      <div class="lab">분류 정확도</div>
    </div>
  </div>
  <table class="stages"><thead><tr><th>판정</th><th>경로</th><th>페이지</th><th>정답</th></tr></thead>
  <tbody>{stage_rows}</tbody></table>
  {errors_html}
</section>"""


def render_html_report(
    pdf_name: str,
    records: list[PageRecord],
    groups: list[Group],
    documents: list[LogicalDoc],
    eval_result: dict | None = None,
    gt: dict | None = None,
    repro_cmd: str = "",
    version: str | None = None,
) -> str:
    n = len(records)
    version = version if version is not None else pipeline_version()
    n_types = len({r.label for r in records})
    n_rule = sum(1 for r in records if r.stage == "rule")
    error_pages = {e["page"]: e for e in (eval_result or {}).get("errors", [])}

    # 4번째 지표 칸: 01은 정확도, 그 외에는 룰 단독 확정 페이지 수
    if eval_result:
        acc = eval_result["accuracy"] * 100
        acc_str = f"{acc:.1f}".rstrip("0").rstrip(".")
        fourth = (f'<div class="stat"><div class="num">{acc_str}'
                  f'<span class="unit">%</span></div>'
                  f'<div class="lab">분류 정확도 (정답 대조)</div></div>')
    else:
        fourth = (f'<div class="stat"><div class="num">{n_rule}'
                  f'<span class="unit">/{n}p</span></div>'
                  f'<div class="lab">룰 단독 확정</div></div>')

    type_css = "\n".join(
        f".t-{label}{{background:{color};color:{LABEL_TEXT.get(label, 'var(--ink)')}}}"
        for label, color in LABEL_COLORS.items()
    )

    eval_html = _eval_section(eval_result, gt) if eval_result and gt else ""

    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>문서 분류 리포트 — {esc(pdf_name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS_HREF}" rel="stylesheet">
<style>
  :root {{
    --ink:        #0a0c0b;
    --paper:      #e9e7dd;
    --paper-dim:  #a9aba0;
    --paper-faint:#82857a;
    --line:       #24271f;
    --line-strong:#31352a; /* 격자 위 구분선 — 격자(--line)와 같으면 묻힌다 */
    --acid:       #c9f24e;
    --serif: "Fraunces", "Gowun Batang", Georgia, serif;
    --mono:  "JetBrains Mono", ui-monospace, Menlo, monospace;
    --sans:  "IBM Plex Sans KR", system-ui, -apple-system, sans-serif;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background-color: var(--ink);
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 64px 64px;
    color: var(--paper);
    font-family: var(--sans);
    word-break: keep-all;
    -webkit-font-smoothing: antialiased;
  }}
  .wrap {{ max-width: 1160px; margin: 0 auto; padding: 56px 40px 72px; }}
  .top {{ display: flex; justify-content: space-between; align-items: baseline; gap: 24px; }}
  .kicker {{
    font-family: var(--mono); font-size: 12px; font-weight: 700;
    letter-spacing: .22em; color: var(--acid); text-transform: uppercase;
  }}
  .ver {{ font-family: var(--mono); font-size: 12px; color: var(--paper-faint); }}
  h1 {{
    margin-top: 20px; font-family: var(--serif); font-weight: 400;
    font-size: clamp(30px, 4.5vw, 46px); line-height: 1.14; letter-spacing: -0.02em;
  }}
  .meta {{ margin-top: 14px; font-family: var(--mono); font-size: 13px; color: var(--paper-dim); }}
  .meta b {{ color: var(--paper); font-weight: 500; }}
  .rule {{ height: 1px; background: var(--line-strong); margin: 36px 0; }}
  section {{ margin-top: 52px; }}
  section .kicker {{ font-size: 11px; }}
  h2 {{ margin-top: 10px; font-family: var(--serif); font-weight: 400; font-size: 25px; }}
  .caption {{ margin-top: 8px; font-size: 13px; line-height: 1.65; color: var(--paper-dim); max-width: 72ch; }}

  .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 4px; }}
  .stat {{ padding-left: 24px; border-left: 1px solid var(--line-strong); }}
  .stat:first-child {{ padding-left: 0; border-left: 0; }}
  .num {{ font-family: var(--mono); font-size: 37px; font-weight: 700; line-height: 1; }}
  .num .unit {{ font-size: 0.62em; font-weight: 400; color: var(--paper-dim); margin-left: 0.1em; }}
  .lab {{
    margin-top: 11px; font-family: var(--mono); font-size: 11px;
    letter-spacing: .08em; color: var(--paper-faint); text-transform: uppercase;
  }}

  .tlwrap {{ overflow-x: auto; padding: 30px 0 36px;
    scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }}
  .tlwrap::-webkit-scrollbar {{ height: 6px; }}
  .tlwrap::-webkit-scrollbar-track {{ background: transparent; }}
  .tlwrap::-webkit-scrollbar-thumb {{ background: var(--line-strong); }}
  .tl {{ display: flex; gap: 2px; min-width: max-content; }}
  .seg {{ display: flex; }}
  .cell {{
    width: 22px; height: 48px; position: relative;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: 10px; font-weight: 700;
  }}
  .cell i {{
    position: absolute; top: calc(100% + 7px); left: 0; right: 0; text-align: center;
    font-style: normal; font-weight: 400; font-size: 9px; color: var(--paper-faint);
  }}
  .cell.m::before {{
    content: ""; position: absolute; bottom: calc(100% + 6px); left: 50%;
    transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%;
    background: var(--paper);
  }}
  .cell.m--low::before {{ background: transparent; border: 1px solid var(--paper-dim); }}
  .legend {{
    display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 14px;
    font-family: var(--mono); font-size: 12px; color: var(--paper-dim);
  }}
  .legend .cnt {{ color: var(--paper-faint); }}
  .chip {{ display: inline-block; width: 10px; height: 10px; margin-right: 8px; }}
  .dot {{
    display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: var(--paper); margin: 0 8px 2px 0; vertical-align: middle;
  }}
  .dot--low {{ background: transparent; border: 1px solid var(--paper-dim); }}

  table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
  th {{
    font-family: var(--mono); font-size: 10.5px; font-weight: 400; letter-spacing: .08em;
    text-transform: uppercase; color: var(--paper-faint); text-align: left;
    padding: 0 16px 9px 0; border-bottom: 1px solid var(--line-strong); white-space: nowrap;
  }}
  td {{
    font-size: 13px; padding: 8px 16px 8px 0; vertical-align: top;
    border-bottom: 1px solid var(--line-strong);
  }}
  .mono {{ font-family: var(--mono); font-size: 12.5px; }}
  .dim {{ color: var(--paper-dim); }}
  .note {{ font-size: 12px; color: var(--paper-dim); }}
  .ev {{
    display: inline-block; font-family: var(--mono); font-size: 11px; color: var(--paper-dim);
    max-width: 46ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    vertical-align: bottom;
  }}
  .tag {{
    display: inline-block; font-family: var(--mono); font-size: 10px; letter-spacing: .06em;
    padding: 2px 7px; border: 1px solid var(--line-strong); color: var(--paper-dim);
    white-space: nowrap;
  }}
  .tag--ai {{ background: var(--paper); border-color: var(--paper); color: var(--ink); font-weight: 700; }}
  .tag--low {{ color: var(--paper-faint); }}
  .tag--err {{ border-color: var(--paper); color: var(--paper); font-weight: 700; margin-left: 6px; }}
  tr.err td {{ border-bottom-color: var(--paper-faint); }}
  .truth {{ display: block; margin-top: 3px; font-family: var(--mono); font-size: 11px; color: var(--paper-dim); }}
  .evalgrid {{ display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 26px; }}
  .stages {{ max-width: 560px; }}
  .ok {{ margin-top: 22px; font-size: 13px; color: var(--paper); }}

  .foot {{ margin-top: 64px; }}
  .foot .cmd {{ font-family: var(--mono); font-size: 12px; color: var(--paper-dim); margin-top: 16px; }}
  .foot .cmd b {{ color: var(--paper); font-weight: 500; }}

  {type_css}

  @media (max-width: 760px) {{
    .wrap {{ padding: 40px 20px 56px; }}
    .stats, .evalgrid {{ grid-template-columns: repeat(2, 1fr); row-gap: 30px; }}
    .stat:nth-child(odd) {{ padding-left: 0; border-left: 0; }}
    .ev {{ max-width: 28ch; }}
  }}
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="top">
      <span class="kicker">Document Classification Report</span>
      <span class="ver">{esc(version)}</span>
    </div>
    <h1>대출 서류 패키지<br>문서 분류 리포트</h1>
    <p class="meta"><b>{esc(pdf_name)}</b> · 총 {n}페이지 · 페이지 단위 분류 + 문서 그루핑</p>
  </header>

  <div class="rule"></div>

  <section style="margin-top:0">
    <div class="stats">
      <div class="stat"><div class="num">{n}<span class="unit">p</span></div>
        <div class="lab">총 페이지</div></div>
      <div class="stat"><div class="num">{len(documents)}</div>
        <div class="lab">재구성 문서</div></div>
      <div class="stat"><div class="num">{n_types}</div>
        <div class="lab">검출 유형</div></div>
      {fourth}
    </div>
  </section>

  <section>
    <div class="kicker">Timeline</div>
    <h2>문서 그루핑 타임라인</h2>
    <p class="caption">페이지 1–{n}을 순서대로 늘어놓고 판정 유형으로 칠했습니다.
    이어진 블록 하나가 연속 문서 그룹이고, 블록 사이 틈이 문서 경계입니다.
    셀 안 문자는 유형 이니셜, 셀 위 점은 판정 경로 표시입니다.</p>
    {_timeline(records, groups)}
    {_legend(records)}
  </section>

  <section>
    <div class="kicker">Groups</div>
    <h2>문서 단위 그룹</h2>
    <p class="caption">같은 유형이 연속된 구간을 하나의 문서로 본 결과입니다. 이
    패키지는 페이지 단위로 완전히 섞여 있어 구간이 짧게 쪼개집니다 — 원래 문서
    단위 추정은 아래 재구성 부록에 있습니다.</p>
    {_groups_table(groups)}
  </section>

  <section>
    <div class="kicker">Reconstruction</div>
    <h2>논리 문서 재구성 <span class="dim" style="font-size:.6em">부록</span></h2>
    <p class="caption">유형과 문서 내부 페이지 번호("Page N of M")로, 번호가 없는
    URLA는 양식 구조 키(Section 1–9 → 부속서 → Lender Loan Information)로 원래
    문서 단위·순서를 추정했습니다. 어느 키도 없는 페이지는 확정할 수 없어 별도
    묶음으로 남깁니다.</p>
    {_documents_table(documents)}
  </section>

  <section>
    <div class="kicker">Pages</div>
    <h2>페이지 단위 분류 결과</h2>
    {_pages_table(records, error_pages)}
  </section>
  {eval_html}

  <footer class="foot">
    <div class="rule" style="margin:0 0 0"></div>
    <p class="cmd">재현 <b>$ {esc(repro_cmd)}</b> — 실행 환경과 옵션은 README 참고</p>
  </footer>

</div>
</body>
</html>
"""


def write_html_report(out_path: str | Path, *args, **kwargs) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_html_report(*args, **kwargs), encoding="utf-8")
