"""loandoc — 섞인 대출 서류 PDF의 페이지 분류·문서 그룹핑 파이프라인."""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "0.1.0"

_REPO_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv() -> None:
    """레포 루트의 .env를 읽어 미설정 환경변수만 채운다(간단 파서).

    경로는 cwd가 아니라 패키지 위치 기준으로 고정한다 — 어느 디렉토리에서
    실행해도 같은 .env를 읽고, 낯선 작업 디렉토리의 .env를 줍지 않는다.
    CLI와 웹 서비스가 공유한다.
    """
    env_file = _REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value
