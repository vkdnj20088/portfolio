"""loandoc 웹 서비스 래퍼 (FastAPI).

CLI 파이프라인을 HTTP API로 노출한다 — "배포 가능한 형태"의 증명이 목적이며,
동봉된 Dockerfile로 그대로 컨테이너 패키징된다. 실무 배포 형태(S3→SQS→워커
비동기 배치)는 README 9절 참고.

설계 노트
- 업로드 PDF는 요청 처리 동안 임시 디렉토리에만 존재하고 응답 후 즉시 삭제된다.
- 서버측 캐시는 기본 비활성 — 서류 원문에서 파생된 텍스트를 서버에 남기지 않는다.
  재처리 성능이 필요하면 LOANDOC_CACHE 환경변수로 캐시 디렉토리를 지정해 켠다.
- LLM 폴백은 ANTHROPIC_API_KEY가 설정돼 있으면 자동 사용하고, llm=off로 끈다.
- 자원 상한: 업로드 100MB·페이지 수 상한·렌더 픽셀 상한·모델 allowlist.
  신뢰 경계 밖 입력이 CPU·메모리·LLM 비용을 무제한 끌어가지 못하게 하는
  동기 데모 API 기준의 방어선이다(실배포 형태는 README 9절).
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from loandoc import load_dotenv
from loandoc.classify import classify_pdf
from loandoc.grouping import group_runs, reconstruct_documents
from loandoc.ingest import IngestError, check_pdf_magic
from loandoc.llm import DEFAULT_MODEL
from loandoc.html_report import (FONTS_HREF, LABEL_COLORS, LABEL_INITIAL,
                                 LABEL_TEXT)
from loandoc.report import build_payload
from loandoc.viz import render_viz

load_dotenv()  # CLI와 같은 레포 루트 .env를 공유한다(미설정 환경변수만 채움)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
# 동기 데모 API의 페이지 수 상한. 100MB 안에도 수만 페이지 PDF가 들어갈 수
# 있고, 페이지 수는 추출 CPU·시각화 크기·LLM 폴백 호출 수(=비용)에 그대로
# 비례한다. 초과분은 배치 경로(README 9절) 몫이다.
MAX_UPLOAD_PAGES = 300
# 폴백 모델 allowlist — 키가 설정된 배포에서 호출자가 임의 모델을 지정해
# 비용을 키우지 못하게 한다. CLI의 --model은 운영자 선택이라 제한하지 않는다.
ALLOWED_MODELS = (DEFAULT_MODEL, "claude-haiku-4-5", "claude-haiku-4-5-20251001")
_viz_lock = threading.Lock()  # matplotlib 전역 상태는 스레드 안전하지 않다

# 커밋된 데모 자산(합성 샘플 패키지 + 완성형 정적 리포트). 재생성은
# scripts/make_demo_package.py — 방문자에게 대출 서류가 있을 리 없으므로,
# 업로드에 바로 쓸 수 있는 합성 샘플을 데모가 직접 나눠 준다.
DEMO_DIR = Path(__file__).resolve().parent.parent / "demo"

# 커밋된 LLM 응답 캐시. 배포에 API 키를 두지 않는다는 원칙을 지키면서도, 동봉 샘플에
# 대해서는 **실제 Claude 가 내린 판정**을 보여주기 위한 산출물이다(요청 해시 -> 응답 JSON).
# 없으면 룰 단독으로 떨어질 뿐 배포는 그대로 뜬다 - 생성은 scripts/make_llm_cache.py.
DEMO_CACHE_DIR = DEMO_DIR / "llm-cache"

app = FastAPI(
    title="loandoc",
    description="대출 서류 패키지 페이지 분류·그룹핑 API",
)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/api/classify")
def api_classify(
    file: UploadFile = File(...),
    llm: str = Query("auto", pattern="^(auto|off)$",
                     description="auto=API 키가 있으면 LLM 폴백 사용, off=룰만"),
    model: str = Query(DEFAULT_MODEL, description="LLM 폴백 모델 ID"),
    include_viz: bool = Query(False, description="시각화 PNG를 base64로 응답에 포함"),
):
    if model not in ALLOWED_MODELS:
        raise HTTPException(
            422, f"허용되지 않은 모델입니다 (허용: {', '.join(ALLOWED_MODELS)})"
        )
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "업로드 한도(100MB)를 초과했습니다")
    if not data:
        raise HTTPException(415, "빈 파일입니다(0바이트)")
    # CLI 인입 게이트와 같은 내용 기준 판정을 공유한다(확장자는 보지 않는다)
    reason = check_pdf_magic(data[:5])
    if reason:
        raise HTTPException(415, reason)

    # 캐시 경로 우선순위: 환경변수 > 커밋된 데모 캐시. 후자가 A안의 핵심이다 -
    # 배포에 키를 두지 않으면서도, 동봉 샘플에 대해서는 **실제 Claude 가 내린 판정**을
    # 그대로 재생한다. 커밋된 응답이 곧 산출물이고, 재현성 장치이기도 하다.
    cache_dir = os.environ.get("LOANDOC_CACHE") or (
        str(DEMO_CACHE_DIR) if DEMO_CACHE_DIR.is_dir() else None)
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    llm_client = None
    if llm == "auto" and (has_key or cache_dir):
        from loandoc.llm import LlmClassifier

        # 키가 없으면 캐시 전용 - 캐시에 없는 입력(방문자 PDF)은 룰 판정으로 남는다.
        llm_client = LlmClassifier(model=model, cache_dir=cache_dir,
                                   cache_only=not has_key)

    tmp = Path(tempfile.mkdtemp(prefix="loandoc-"))
    try:
        # 파일명은 표시용으로만 쓴다. basename만 취하되 ".."·제어문자·과대 길이
        # 같은 엣지가 파일 생성 실패(500)로 새지 않게 정리하고, 남는 게 없으면
        # 고정명으로 폴백한다.
        raw_name = Path(file.filename or "").name
        safe_name = "".join(
            c for c in raw_name if c.isprintable() and c not in '/\\'
        )[:100]
        if safe_name in ("", ".", ".."):
            safe_name = "upload.pdf"
        pdf_path = tmp / safe_name
        pdf_path.write_bytes(data)
        try:
            records = classify_pdf(pdf_path, cache_dir=cache_dir, llm=llm_client,
                                   max_pages=MAX_UPLOAD_PAGES)
        except HTTPException:
            raise
        except IngestError as e:  # 암호화·0페이지·파싱 실패 — 정리된 메시지 그대로
            raise HTTPException(422, str(e)) from e
        except Exception as e:  # 그 외 예기치 못한 실패
            raise HTTPException(422, f"PDF 처리 실패: {e}") from e

        groups = group_runs(records)
        documents = reconstruct_documents(records)
        payload = build_payload(pdf_path.name, records, groups, documents)
        # "사용/미사용" 이분법으로는 이 데모의 실제 상태를 말할 수 없다. 배포에는 키가 없고,
        # 그래도 동봉 샘플에는 실제 Claude 판정이 붙는다(커밋된 응답 재생). 화면이 그 차이를
        # 그대로 말하도록 모드와 적용 면수를 함께 싣는다.
        llm_pages = sum(1 for r in records if r.stage == "llm")
        payload["llm_used"] = llm_pages > 0
        payload["llm_pages"] = llm_pages
        payload["llm_mode"] = ("live" if has_key else "cached") if llm_client else "off"

        if include_viz:
            viz_path = tmp / "viz.png"
            with _viz_lock:
                render_viz(viz_path, pdf_path.name, records)
            payload["viz_png_base64"] = base64.standard_b64encode(
                viz_path.read_bytes()
            ).decode()
        return JSONResponse(payload)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


_INDEX_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JC LoanDoc — 대출 서류 패키지 페이지 분류</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="__FONTS__" rel="stylesheet">
<style>
  :root {
    --ink: #0a0c0b; --paper: #e9e7dd; --paper-dim: #a9aba0; --paper-faint: #82857a;
    --line: #24271f; --line-strong: #31352a; --acid: #c9f24e;
    --serif: "Fraunces", "Gowun Batang", Georgia, serif;
    --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
    --sans: "IBM Plex Sans KR", system-ui, -apple-system, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background-color: var(--ink);
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 64px 64px;
    color: var(--paper); font-family: var(--sans); word-break: keep-all;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1160px; margin: 0 auto; padding: 56px 40px 72px; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; flex-wrap: wrap; }
  .kicker {
    font-family: var(--mono); font-size: 12px; font-weight: 700;
    letter-spacing: .22em; color: var(--acid); text-transform: uppercase;
  }
  /* 귀속 → 역할 위계. 다른 데모들과 문구·순서를 통일한다(자리는 앱마다 다르다). */
  .ident { display: flex; flex-direction: column; gap: 3px; text-align: right; }
  .ident-owner { font-size: 12.5px; color: var(--paper-dim); }
  .ident-role { font-family: var(--mono); font-size: 11px; color: var(--paper-faint); }
  .links { display: flex; flex-wrap: wrap; gap: 10px 28px; margin-top: 22px; }
  .links a {
    font-family: var(--mono); font-size: 12px; letter-spacing: .04em;
    color: var(--paper-dim); text-decoration: none;
    border-bottom: 1px solid var(--line-strong); padding-bottom: 2px;
  }
  .links a:hover { color: var(--acid); border-color: var(--acid); }
  h1 {
    margin-top: 20px; font-family: var(--serif); font-weight: 400;
    font-size: clamp(30px, 4.5vw, 46px); line-height: 1.14; letter-spacing: -0.02em;
  }
  .caption { margin-top: 12px; font-size: 13px; line-height: 1.65; color: var(--paper-dim); max-width: 68ch; }
  .rule { height: 1px; background: var(--line-strong); margin: 32px 0; }

  form { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  input[type="file"] { font-family: var(--mono); font-size: 12px; color: var(--paper-dim); }
  input[type="file"]::file-selector-button {
    font-family: var(--mono); font-size: 12px; letter-spacing: .06em;
    color: var(--paper); background: transparent; border: 1px solid var(--line-strong);
    padding: 9px 16px; margin-right: 14px; cursor: pointer;
  }
  input[type="file"]::file-selector-button:hover { border-color: var(--paper-dim); }
  .chk { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12px; color: var(--paper-dim); }
  .chk input { accent-color: var(--acid); }
  button[type="submit"], #runsample {
    font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: .1em;
    text-transform: uppercase; color: var(--paper); background: transparent;
    border: 1px solid var(--paper); padding: 10px 22px; cursor: pointer;
  }
  button[type="submit"]:hover, #runsample:hover { background: var(--acid); border-color: var(--acid); color: var(--ink); }
  #runsample { border-color: var(--line-strong); color: var(--paper-dim); }
  #status { font-family: var(--mono); font-size: 12px; color: var(--paper-dim); }

  section { margin-top: 48px; }
  section .kicker { font-size: 11px; }
  h2 { margin-top: 10px; font-family: var(--serif); font-weight: 400; font-size: 24px; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 8px; }
  .stat { padding-left: 24px; border-left: 1px solid var(--line-strong); }
  .stat:first-child { padding-left: 0; border-left: 0; }
  .num { font-family: var(--mono); font-size: 34px; font-weight: 700; line-height: 1; }
  .num .unit { font-size: 0.62em; font-weight: 400; color: var(--paper-dim); margin-left: 0.1em; }
  .lab { margin-top: 10px; font-family: var(--mono); font-size: 11px; letter-spacing: .08em;
         color: var(--paper-faint); text-transform: uppercase; }

  .tlwrap { overflow-x: auto; padding: 28px 0 34px;
    scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
  .tlwrap::-webkit-scrollbar { height: 6px; }
  .tlwrap::-webkit-scrollbar-track { background: transparent; }
  .tlwrap::-webkit-scrollbar-thumb { background: var(--line-strong); }
  .tl { display: flex; gap: 2px; min-width: max-content; }
  .seg { display: flex; }
  .cell {
    width: 22px; height: 48px; position: relative;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: 10px; font-weight: 700;
  }
  .cell i {
    position: absolute; top: calc(100% + 7px); left: 0; right: 0; text-align: center;
    font-style: normal; font-weight: 400; font-size: 9px; color: var(--paper-faint);
  }
  .cell.m::before {
    content: ""; position: absolute; bottom: calc(100% + 6px); left: 50%;
    transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%;
    background: var(--paper);
  }
  .cell.m--low::before { background: transparent; border: 1px solid var(--paper-dim); }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 12px;
            font-family: var(--mono); font-size: 12px; color: var(--paper-dim); }
  .legend .cnt { color: var(--paper-faint); }
  .chip { display: inline-block; width: 10px; height: 10px; margin-right: 8px; }
  .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%;
         background: var(--paper); margin: 0 8px 2px 0; vertical-align: middle; }
  .dot--low { background: transparent; border: 1px solid var(--paper-dim); }

  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th { font-family: var(--mono); font-size: 10.5px; font-weight: 400; letter-spacing: .08em;
       text-transform: uppercase; color: var(--paper-faint); text-align: left;
       padding: 0 16px 9px 0; border-bottom: 1px solid var(--line-strong); white-space: nowrap; }
  td { font-size: 13px; padding: 8px 16px 8px 0; vertical-align: top;
       border-bottom: 1px solid var(--line-strong); }
  .mono { font-family: var(--mono); font-size: 12.5px; }
  .dim { color: var(--paper-dim); }
  .ev { display: inline-block; font-family: var(--mono); font-size: 11px; color: var(--paper-dim);
        max-width: 46ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        vertical-align: bottom; }
  .tag { display: inline-block; font-family: var(--mono); font-size: 10px; letter-spacing: .06em;
         padding: 2px 7px; border: 1px solid var(--line-strong); color: var(--paper-dim); white-space: nowrap; }
  .tag--ai { background: var(--paper); border-color: var(--paper); color: var(--ink); font-weight: 700; }
  .tag--low { color: var(--paper-faint); }

  /* 인트로 복귀 고정 버튼 - 다른 세 데모(거래소/챗/Guard)와 같은 중립 다크 알약.
     이 앱만 없어서 데모를 보고 나온 사람이 주소창을 고쳐야 다음 데모로 갈 수 있었다.
     기본은 숨김이고, 주소를 만들 수 있을 때만(아래 스크립트) 드러낸다 - 로컬에서는
     인트로 위치를 알 수 없어 죽은 링크가 되기 때문이다. */
  .portfolio-home {
    position: fixed; right: 18px; bottom: 18px; z-index: 1000;
    display: none; align-items: center; gap: 7px;
    padding: 8px 13px; border-radius: 8px;
    background: rgba(18, 18, 18, 0.92); color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 12.5px; font-weight: 600; text-decoration: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .portfolio-home:hover, .portfolio-home:focus-visible {
    background: rgba(30, 30, 30, 0.96); border-color: rgba(255, 255, 255, 0.4);
  }
  .portfolio-home[href] { display: inline-flex; }

  @media (max-width: 760px) {
    .wrap { padding: 40px 20px 56px; }
    .stats { grid-template-columns: repeat(2, 1fr); row-gap: 28px; }
    .stat:nth-child(odd) { padding-left: 0; border-left: 0; }
    .ev { max-width: 26ch; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <span class="kicker">JC LoanDoc &mdash; Document Classification</span>
    <div class="ident">
      <span class="ident-owner">최종은의 Python + FastAPI 포트폴리오</span>
      <span class="ident-role">Front-end 파트장 &#183; Full-stack &#183; IT 경력 12년+</span>
    </div>
  </div>
  <h1>대출 서류 패키지<br>페이지 분류</h1>
  <p class="caption">여러 대출 서류가 페이지 단위로 섞인 PDF 패키지를 업로드하면
  페이지별 유형 판정과 문서 그루핑 결과를 보여줍니다. 실서비스가 아닌 데모이며
  예시 데이터는 전부 합성 픽스처입니다(실서류&#183;개인정보 없음). 업로드 파일은 처리 후
  즉시 삭제되고 서버에 남지 않습니다.__LLMNOTE__</p>

  <div class="links">
    <a href="/sample.pdf" download>합성 샘플 패키지 내려받기 (16p)</a>
    <a href="/report">파이프라인 산출 리포트 완성형 보기</a>
  </div>

  <div class="rule"></div>

  <form id="f">
    <input type="file" id="file" name="file" accept="application/pdf" required>
    __LLMCHK__
    <button type="submit">분류 실행</button>
    <button type="button" id="runsample">샘플로 바로 실행</button>
    <span id="status"></span>
  </form>

  <div id="out"></div>
</div>
<!-- href 는 스크립트가 채운다(위 CSS 의 [href] 규칙으로 그때 비로소 보인다). -->
<a class="portfolio-home" id="phome" rel="noopener noreferrer"><span aria-hidden="true">&#8592;</span> 포트폴리오</a>
<script>
const PALETTE = __PALETTE__;
const TEXTCOL = __TEXTCOL__;
const INITIAL = __INITIAL__;
const STAGE_TAG = {
  rule: '<span class="tag">RULE</span>',
  llm: '<span class="tag tag--ai">AI</span>',
  rule_lowconf: '<span class="tag tag--low">RULE·저신뢰</span>',
};
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function renderResult(d) {
  const nRule = (d.stage_distribution.rule || 0);
  const cells = (g) => {
    let out = "";
    for (let p = g.start; p <= g.end; p++) {
      const pg = d.pages[p - 1];
      const m = pg.stage === "llm" ? " m" : (pg.stage === "rule_lowconf" ? " m m--low" : "");
      out += `<span class="cell${m}" style="background:${PALETTE[pg.label]};color:${TEXTCOL[pg.label] || "var(--ink)"}"` +
             ` title="p${p} · ${esc(pg.label)} · ${esc(pg.stage)}">${INITIAL[pg.label]}<i>${p}</i></span>`;
    }
    return `<span class="seg">${out}</span>`;
  };
  const counts = {};
  d.pages.forEach((p) => { counts[p.label] = (counts[p.label] || 0) + 1; });
  const legend = Object.keys(PALETTE).filter((l) => counts[l]).map((l) =>
    `<span><i class="chip" style="background:${PALETTE[l]}"></i>${INITIAL[l]} · ${esc(l)} ` +
    `<span class="cnt">${counts[l]}p</span></span>`).join("") +
    '<span><span class="dot"></span>AI 판정</span>' +
    '<span><span class="dot dot--low"></span>룰 저신뢰 추정</span>';
  const evidence = (p) => {
    const t = p.stage === "llm" && p.llm && p.llm.reason ? p.llm.reason
            : (p.rule.matched || []).join("+") || "—";
    const short = t.length > 110 ? t.slice(0, 107) + "…" : t;
    return `<span class="ev" title="${esc(t)}">${esc(short)}</span>`;
  };
  const rows = d.pages.map((p) =>
    `<tr><td class="mono">p${p.page}</td>` +
    `<td><i class="chip" style="background:${PALETTE[p.label]}"></i><span class="mono">${esc(p.label)}</span></td>` +
    `<td>${STAGE_TAG[p.stage] || esc(p.stage)}</td>` +
    `<td class="mono dim">${esc(p.confidence)}</td>` +
    `<td>${evidence(p)}</td></tr>`).join("");

  document.getElementById("out").innerHTML = `
    <section>
      <div class="stats">
        <div class="stat"><div class="num">${d.num_pages}<span class="unit">p</span></div>
          <div class="lab">총 페이지</div></div>
        <div class="stat"><div class="num">${d.documents.length}</div>
          <div class="lab">재구성 문서</div></div>
        <div class="stat"><div class="num">${Object.keys(d.label_distribution).length}</div>
          <div class="lab">검출 유형</div></div>
        <div class="stat"><div class="num">${nRule}<span class="unit">/${d.num_pages}p</span></div>
          <div class="lab">룰 단독 확정</div></div>
      </div>
    </section>
    <section>
      <div class="kicker">Timeline</div>
      <h2>문서 그루핑 타임라인</h2>
      <div class="tlwrap"><div class="tl">${d.groups.map(cells).join("")}</div></div>
      <div class="legend">${legend}</div>
    </section>
    <section>
      <div class="kicker">Pages</div>
      <h2>페이지 단위 분류 결과</h2>
      <table><thead><tr><th>페이지</th><th>판정 유형</th><th>판정</th><th>신뢰도</th><th>근거</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;
}
window.renderResult = renderResult;

async function classify(file) {
  const status = document.getElementById("status");
  const out = document.getElementById("out");
  out.innerHTML = "";
  status.textContent = "처리 중…";
  const fd = new FormData();
  fd.append("file", file);
  const nollm = document.getElementById("nollm");
  const llm = nollm && nollm.checked ? "off" : "auto";
  try {
    const res = await fetch(`/api/classify?llm=${llm}`, { method: "POST", body: fd });
    if (!res.ok) { status.textContent = `오류 ${res.status} — ${esc(await res.text())}`; return; }
    const d = await res.json();
  // 모드를 그대로 말한다. cached 는 "배포에 키가 없는데도 실제 판정이 붙은" 상태라
  // 한 줄로 설명하지 않으면 방문자가 실시간 호출로 오해한다.
  const LLM_NOTE = {
    live: (n) => `LLM 판정 ${n}면 (실시간 호출)`,
    cached: (n) => n > 0
      ? `LLM 판정 ${n}면 — 실제 Claude 응답을 캐시에서 재생(서버에 키 없음)`
      : "LLM 미적용 — 이 입력은 커밋된 캐시에 없어 룰 단독으로 판정했습니다",
    off: () => "LLM 미사용 (룰 단독)",
  };
  const note = (LLM_NOTE[d.llm_mode] || LLM_NOTE.off)(d.llm_pages || 0);
  status.textContent = `완료 — ${d.num_pages}페이지 · ${note}`;
    renderResult(d);
  } catch (err) {
    // fetch가 응답 없이 실패하면 대부분 서버 미기동/연결 끊김이다
    status.textContent = (err instanceof TypeError)
      ? "서버에 연결할 수 없습니다 — 잠시 후 다시 시도해 주세요"
      : "요청 실패 — " + esc(err);
  }
}

document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  classify(document.getElementById("file").files[0]);
});

// 동봉된 합성 샘플로 한 클릭 실행 - 방문자에게 대출 서류 PDF 가 있을 리 없다.
async function runSample() {
  const status = document.getElementById("status");
  status.textContent = "샘플 불러오는 중…";
  const pdf = await (await fetch("/sample.pdf")).blob();
  await classify(new File([pdf], "demo_package.pdf", { type: "application/pdf" }));
}
document.getElementById("runsample").addEventListener("click", runSample);
// ?sample=1 로 진입하면 자동 실행한다(결과 화면으로 바로 데려가는 딥링크).
if (new URLSearchParams(location.search).get("sample") === "1") runSample();

// 인트로 복귀 링크를 **지금 호스트에서 조립**한다. 다른 세 데모(거래소 lib/portfolioHome.ts,
// 챗 @chat/ui, Guard config.ts)와 같은 규칙의 네 번째 벌이다 - 빌드 상수로 두면 도메인을
// 붙이거나 서버가 바뀔 때마다 네 곳이 조용히 옛 주소를 가리킨다.
//   - 서브도메인 배포: 첫 라벨(loandoc.)을 뗀다.
//   - IP 배포:        포트를 뗀다(인트로는 443).
//   - 로컬:           인트로 위치를 알 수 없으므로 링크를 만들지 않는다(버튼은 숨은 채).
// 목적지가 루트가 아니라 #demos 인 이유는 인트로가 긴 한 장이라 목록이 한참 아래 있어서다.
// ?from=loandoc 은 인트로가 그 카드에 "방금 본 데모" 표식을 다는 데 쓴다(카드의 data-demo 와
// 같은 값). referrer 를 쓰지 않는 것은 이 앱도 Referrer-Policy: no-referrer 이기 때문이다.
(function () {
  const h = location.hostname;
  // 정규식 대신 목록 비교인 이유: 이 스크립트는 파이썬 문자열 안에 산다. 정규식이 점이나
  // 대괄호를 escape 하려고 쓰는 역슬래시는 파이썬에게 알 수 없는 이스케이프라
  // SyntaxWarning 을 내고 언젠가 오류가 된다(이 주석 자체도 같은 제약을 받는다).
  if (location.protocol === "file:" ||
      ["localhost", "127.0.0.1", "::1", "[::1]"].indexOf(h) >= 0) return;
  const path = "/?from=loandoc#demos";
  const labels = h.split(".");
  // 끝이 알파벳이 아니면 IP 리터럴이다(IPv6 포함) - 서브도메인을 붙이거나 뗄 수 없다.
  const isIp = !/[a-z]$/i.test(h) || h.indexOf(":") >= 0;
  const origin = isIp ? "https://" + h
    : "https://" + (labels.length > 2 ? labels.slice(1).join(".") : h);
  document.getElementById("phome").setAttribute("href", origin + path);
})();
</script>
</body>
</html>"""

_INDEX_BASE = (
    _INDEX_TEMPLATE
    .replace("__FONTS__", FONTS_HREF)
    .replace("__PALETTE__", json.dumps(LABEL_COLORS))
    .replace("__TEXTCOL__", json.dumps(LABEL_TEXT))
    .replace("__INITIAL__", json.dumps(LABEL_INITIAL))
)

_LLM_CHECKBOX = ('<label class="chk"><input type="checkbox" id="nollm"> '
                 "LLM 폴백 끄기 (룰만)</label>")
# 키도 캐시도 없을 때. 룰 단독이라는 사실만 밝힌다.
_NO_LLM_NOTE = (" 이 배포는 LLM API 키를 두지 않아 <b>룰 단독</b>으로 동작합니다"
                " &mdash; 룰이 확정하지 못한 페이지는 저신뢰 추정으로 표시됩니다.")
# 키는 없지만 커밋된 캐시가 있을 때(포트폴리오 배포의 기본). 실제 판정을 보여 주면서도
# 실시간 호출로 오해하지 않게, 무엇이 재생이고 무엇이 룰인지 경계를 문장이 직접 말한다.
_CACHED_LLM_NOTE = (
    " 이 배포는 LLM API 키를 두지 않습니다. 대신 <b>동봉 샘플</b>에 한해 실제 Claude 가 내린"
    " 판정을 커밋해 두고 그대로 재생합니다 &mdash; 직접 올리신 PDF 는 캐시에 없으므로"
    " <b>룰 단독</b>으로 판정합니다.")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    # 토글은 실제로 끌 것이 있을 때만 보여 준다 - 동작하지 않는 컨트롤은 노이즈다.
    # 캐시 재생 모드에서도 끄기는 의미가 있다(룰 단독과 나란히 비교하는 것이 이 데모의 요점).
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_cache = DEMO_CACHE_DIR.is_dir()
    if has_key:
        note = ""
    elif has_cache:
        note = _CACHED_LLM_NOTE
    else:
        note = _NO_LLM_NOTE
    return (_INDEX_BASE
            .replace("__LLMCHK__", _LLM_CHECKBOX if (has_key or has_cache) else "")
            .replace("__LLMNOTE__", note))


@app.get("/sample.pdf")
def sample_pdf() -> FileResponse:
    """합성 샘플 패키지 - 방문자가 업로드 데모에 바로 쓸 입력."""
    path = DEMO_DIR / "demo_package.pdf"
    if not path.is_file():
        raise HTTPException(404, "샘플이 없습니다 - scripts/make_demo_package.py 로 생성합니다")
    return FileResponse(path, media_type="application/pdf",
                        filename="demo_package.pdf")


@app.get("/report", response_class=HTMLResponse)
def report() -> HTMLResponse:
    """합성 샘플을 파이프라인으로 돌린 완성형 정적 리포트."""
    path = DEMO_DIR / "report.html"
    if not path.is_file():
        raise HTTPException(404, "리포트가 없습니다 - scripts/make_demo_package.py 로 생성합니다")
    return HTMLResponse(path.read_text(encoding="utf-8"))
