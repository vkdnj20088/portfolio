"""PDF 페이지를 PNG 바이트로 렌더링 (LLM 비전 폴백용)."""

from __future__ import annotations

import io
import threading
from pathlib import Path

import pypdfium2 as pdfium

RENDER_SCALE = 2.0  # 약 150dpi — 서식 판독에 충분하면서 요청 크기 절약
MAX_RENDER_DIM = 4000  # px — 조작된 초대형 MediaBox의 메모리 폭주를 막는 상한

# PDFium은 스레드 세이프하지 않다 — 서로 다른 문서라도 동시 호출이 불가하므로
# 프로세스 전역 락으로 직렬화한다. LLM 폴백 병렬 호출과 웹의 동시 요청이
# 모두 이 경로를 지난다(렌더링은 페이지당 ~100ms라 직렬이어도 병목이 아니다).
_PDFIUM_LOCK = threading.Lock()


def render_page_png(pdf_path: str | Path, page_number: int) -> bytes:
    """1기준 페이지 번호의 페이지를 PNG 바이트로 반환한다."""
    with _PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(str(pdf_path))
        try:
            page = pdf[page_number - 1]
            # 페이지 크기(pt)에 배율을 곱한 최장 변이 상한을 넘으면 배율을 줄인다
            width, height = page.get_size()
            scale = min(RENDER_SCALE, MAX_RENDER_DIM / max(width, height, 1.0))
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            pdf.close()
