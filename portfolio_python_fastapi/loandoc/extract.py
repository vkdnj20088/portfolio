"""PDF 페이지별 텍스트 추출과 로컬 캐시.

캐시에는 서류 원문 텍스트가 담기므로 repo에 커밋하지 않는다(.gitignore 처리).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from pypdf import PdfReader

from .ingest import IngestError

# 추출 로직이 바뀌면 버전을 올려 캐시를 무효화한다.
EXTRACTOR_VERSION = "pypdf-v1"


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _check_page_cap(n_pages: int, max_pages: int | None) -> None:
    if max_pages is not None and n_pages > max_pages:
        raise IngestError(
            f"페이지 수({n_pages})가 처리 한도({max_pages}페이지)를 초과합니다 — "
            "대용량 패키지는 배치 경로로 처리하라"
        )


def extract_pages(
    pdf_path: str | Path,
    cache_dir: str | Path | None = None,
    max_pages: int | None = None,
) -> list[str]:
    """페이지별 추출 텍스트 리스트를 반환한다(0-index = 1페이지).

    max_pages는 신뢰 경계 밖 입력(웹 업로드)의 자원 상한 — 고비용 단계(텍스트
    추출) 전에 페이지 수만 보고 거절한다. CLI는 지정하지 않는다(운영자 파일).
    """
    pdf_path = Path(pdf_path)
    cache_file = None
    if cache_dir is not None:
        key = f"{file_sha256(pdf_path)}-{EXTRACTOR_VERSION}"
        cache_file = Path(cache_dir) / "text" / f"{key}.json"
        if cache_file.exists():
            pages = json.loads(cache_file.read_text(encoding="utf-8"))
            _check_page_cap(len(pages), max_pages)
            return pages

    # 파싱 단계 방어: 파서 내부 예외를 스택트레이스 노출 없이 정리된
    # 에러로 바꾸고, 추출이 불가능한 상태(암호화·0페이지)는 명확히 거절한다.
    try:
        reader = PdfReader(str(pdf_path))
        if reader.is_encrypted:
            raise IngestError(
                "암호화된 PDF라 텍스트를 추출할 수 없습니다 — 암호 해제본으로 다시 시도해 주세요",
                exit_code=3,
            )
        _check_page_cap(len(reader.pages), max_pages)
        pages = [(page.extract_text() or "") for page in reader.pages]
    except IngestError:
        raise
    except Exception as e:
        raise IngestError(
            f"PDF 파싱에 실패했습니다({type(e).__name__}) — 파일이 손상됐거나 "
            "지원되지 않는 형식입니다",
            exit_code=3,
        ) from e
    if not pages:
        raise IngestError("페이지가 0개인 PDF입니다 — 처리할 내용이 없습니다", exit_code=3)

    if cache_file is not None:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    return pages


def normalize_text(text: str) -> str:
    """대조·비교용 정규화: 소문자화 + 연속 공백 접기."""
    return " ".join(text.lower().split())
