"""합성 PDF 픽스처 — 이 데모가 보여주는 모든 데이터의 원천.

이 포트폴리오의 원칙(§0)에 따라 데모에는 실데이터를 쓰지 않는다. 여기 픽스처는
공개 표준 양식의 명칭·상용구(예: Uniform Residential Loan Application, W-2 필드
라벨)만 쓰고, 사기업 상호·실존 인물·실제 주소는 넣지 않는다. 등장 인물과 금액은
전부 가공이다.

build_pdf 는 외부 의존성 없이 최소 PDF 를 손으로 조립한다 — 같은 입력이면
바이트까지 같은 출력이 나오므로(타임스탬프·난수 없음) 재현성 검사에 그대로 쓴다.
텍스트는 Helvetica(WinAnsi) 스트림이라 ASCII 만 허용한다.
"""

from __future__ import annotations

# ── CI 스모크용 4페이지: 유형당 1페이지, 전부 룰 고신뢰 확정 ────────────────
SMOKE_PAGES: list[tuple[str, str]] = [
    ("Uniform Residential Loan Application\n"
     "Borrower Name: Jamie Sample", "URLA_1003"),
    ("Credit Score Disclosure\n"
     "Repositories: TU / EXP / EFX", "CREDIT_REPORT"),
    ("Commitment for Title Insurance\nPage 1 of 2", "TITLE_REPORT"),
    ("This Product Contains Sensitive Taxpayer Data\n"
     "Wage and Income Transcript", "INCOME_DOC"),
]

# ── 데모 패키지 16페이지: 문서 5종이 페이지 단위로 섞인 형태 ────────────────
# (텍스트, 기대 라벨, 기대 판정 단계). 마지막 열은 make_demo_package 의 자기
# 검증과 스모크가 함께 쓴다. 15페이지는 룰 고신뢰, 지적도 1페이지만 저신뢰로
# 남겨 "룰이 못 정하는 페이지" 표시(및 LLM 폴백 자리)를 화면에서 보여준다.
DEMO_PAGES: list[tuple[str, str, str]] = [
    ("Commitment for Title Insurance\n"
     "Schedule B - Exceptions\n"
     "Order No.: JC-2026-0412\n"
     "Page 1 of 3", "TITLE_REPORT", "rule"),
    ("Uniform Residential Loan Application\n"
     "Section 1: Borrower Information\n"
     "Borrower Name: Jamie Sample\n"
     "Page 1 of 4", "URLA_1003", "rule"),
    ("Credit Score Disclosure\n"
     "Repositories: TU / EXP / EFX\n"
     "Page 1 of 3", "CREDIT_REPORT", "rule"),
    ("Form W-2 Wage and Tax Statement\n"
     "Wages, tips, other compensation: $88,400.00\n"
     "Employer Identification Number (EIN): 00-0000000", "INCOME_DOC", "rule"),
    ("Uniform Residential Loan Application\n"
     "Section 3: Financial Information - Assets and Liabilities\n"
     "Page 2 of 4", "URLA_1003", "rule"),
    ("Commitment for Title Insurance\n"
     "Exhibit A - Legal Description\n"
     "Easement as noted in instrument JC-88231\n"
     "Page 2 of 3", "TITLE_REPORT", "rule"),
    ("Your Credit Score and the Price You Pay for Credit\n"
     "Page 2 of 3", "CREDIT_REPORT", "rule"),
    ("This Product Contains Sensitive Taxpayer Data\n"
     "Wage and Income Transcript\n"
     "Tax Year 2025", "INCOME_DOC", "rule"),
    ("Uniform Residential Loan Application - Lender Loan Information\n"
     "Page 3 of 4", "URLA_1003", "rule"),
    ("Uniform Residential Appraisal Report\n"
     "Subject Property: 123 Sample Ave", "OTHER", "rule"),
    ("Commitment for Title Insurance\n"
     "Schedule B - Part II\n"
     "Page 3 of 3", "TITLE_REPORT", "rule"),
    ("Earnings Statement\n"
     "Gross Pay: $7,366.67   Net Pay: $5,102.13\n"
     "YTD Gross: $58,933.36", "INCOME_DOC", "rule"),
    ("Uniform Residential Loan Application - Continuation Sheet\n"
     "Page 4 of 4", "URLA_1003", "rule"),
    ("Understanding Your Credit Score\n"
     "Repositories: TU / EXP / EFX\n"
     "Page 3 of 3", "CREDIT_REPORT", "rule"),
    ("Plat Map - Exhibit C\n"
     "[ drawing placeholder - no text signals ]", "TITLE_REPORT",
     "rule_lowconf"),
    ("Profit & Loss Statement\n"
     "Jamie Sample Consulting\n"
     "January 1 - December 31, 2025", "INCOME_DOC", "rule"),
]


def build_pdf(page_texts: list[str]) -> bytes:
    """텍스트 오브젝트가 든 최소 PDF를 손으로 조립한다(외부 의존성 없음)."""

    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    n_pages = len(page_texts)
    # 오브젝트 번호: 1=Catalog, 2=Pages, 3=Font, 이후 페이지당 (Page, Contents) 쌍
    objects: list[bytes] = []
    kids = " ".join(f"{4 + i * 2} 0 R" for i in range(n_pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, text in enumerate(page_texts):
        lines = text.split("\n")
        stream_parts = ["BT /F1 12 Tf 72 720 Td"]
        for j, line in enumerate(lines):
            if j > 0:
                stream_parts.append("0 -16 Td")
            stream_parts.append(f"({esc(line)}) Tj")
        stream_parts.append("ET")
        stream = " ".join(stream_parts).encode()
        objects.append(
            (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
             f"/Resources << /Font << /F1 3 0 R >> >> "
             f"/Contents {5 + i * 2} 0 R >>").encode()
        )
        objects.append(
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]  # 오브젝트 0은 free
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{num} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n").encode()
    return bytes(out)
