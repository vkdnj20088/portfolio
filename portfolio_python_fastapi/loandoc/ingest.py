"""인입 검증 게이트 — PDF 파싱 이전에 싸게 거르고 명확하게 실패한다.

실무에서 이 파이프라인의 입력은 브로커·차주가 올리는 신뢰 불가 파일이고,
파일명 확장자는 위조된다(virus.exe → loan.pdf). 판정 권한은 파일 내용
(매직넘버)에 두고 확장자는 참고 신호로만 쓴다. PDF 파서는 그 자체가 공격
표면이므로, 파서에 닿기 전에 명백한 비-PDF를 거절하는 것이 낫다.

종료코드 규약: 정상 0 / 인입 검증 거절 2 / 파싱 단계 실패 3.
"""

from __future__ import annotations

from pathlib import Path

PDF_MAGIC = b"%PDF-"

# 앞 바이트로 식별되는 대표 실행파일 시그니처. "PDF 아님"보다 구체적인
# 거절 사유를 주기 위한 최소 목록이며, 시그니처 DB를 두자는 것이 아니다.
EXECUTABLE_SIGNATURES = (
    (b"MZ", "Windows 실행파일(PE/MZ)"),
    (b"\x7fELF", "리눅스 실행파일(ELF)"),
    (b"#!", "실행 스크립트(shebang)"),
)


class IngestError(Exception):
    """입력 거절. message는 사용자에게 그대로 보여줄 문장이다."""

    def __init__(self, message: str, exit_code: int = 2):
        super().__init__(message)
        self.exit_code = exit_code


def check_pdf_magic(head: bytes) -> str | None:
    """내용 기준 PDF 판별. 거절 사유 문자열, 통과면 None.

    매직넘버는 오프셋 0만 인정한다. 일부 구형 도구는 첫 1024바이트 안의
    헤더도 허용하지만, 그 관용이 위장 파일의 통과 경로가 되므로 인입
    게이트는 엄격한 쪽을 택한다.
    """
    if head.startswith(PDF_MAGIC):
        return None
    for sig, name in EXECUTABLE_SIGNATURES:
        if head.startswith(sig):
            return (f"PDF가 아닙니다(내용 기준) — 파일 서두가 {name} 시그니처입니다. "
                    "확장자와 무관하게 거절합니다")
    return "PDF가 아닙니다(내용 기준) — 파일 서두에 %PDF- 헤더가 없습니다"


def validate_pdf_input(path: str | Path) -> list[str]:
    """파싱 전 인입 게이트. 통과 시 경고 목록을 반환하고, 거절 시 IngestError.

    경고는 처리를 막지 않는 참고 신호다(현재는 확장자 불일치 한 종류).
    """
    p = Path(path)
    if not p.is_file():
        raise IngestError(f"입력 파일이 없다: {p}")
    if p.stat().st_size == 0:
        raise IngestError(f"빈 파일이다(0바이트): {p.name}")

    with open(p, "rb") as f:
        head = f.read(len(PDF_MAGIC))
    reason = check_pdf_magic(head)
    if reason:
        raise IngestError(f"{reason}: {p.name}")

    warnings: list[str] = []
    if p.suffix.lower() != ".pdf":
        # 확장자는 판정에 쓰지 않는다 — 내용이 PDF면 처리하고 기록만 남긴다
        warnings.append(
            f"경고: 내용은 PDF지만 확장자가 '{p.suffix or '(없음)'}'이다 "
            f"— 내용 기준으로 계속 처리한다: {p.name}"
        )
    return warnings
