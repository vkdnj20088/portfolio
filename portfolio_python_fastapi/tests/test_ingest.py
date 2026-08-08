"""인입 검증 게이트·파싱 방어 테스트.

픽스처는 전부 코드로 생성한 몇 바이트짜리 합성 파일이다 — 실서류를
테스트에 쓰지 않는다. 모든 케이스는 결정적이다.
"""

import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from loandoc.extract import extract_pages
from loandoc.ingest import IngestError, check_pdf_magic, validate_pdf_input

REPO_ROOT = Path(__file__).resolve().parent.parent


class _TmpDirTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.base = Path(self._dir.name)

    def tearDown(self):
        self._dir.cleanup()

    def write(self, name: str, data: bytes) -> Path:
        p = self.base / name
        p.write_bytes(data)
        return p


class TestGate(_TmpDirTest):
    def test_minimal_pdf_header_passes(self):
        p = self.write("ok.pdf", b"%PDF-1.7\n%%EOF")
        self.assertEqual(validate_pdf_input(p), [])

    def test_exe_disguised_as_pdf_rejected_with_signature_name(self):
        # virus.exe → loan.pdf 위장 시나리오: 확장자는 .pdf지만 내용이 PE
        p = self.write("loan.pdf", b"MZ\x90\x00\x03\x00\x00\x00")
        with self.assertRaises(IngestError) as cm:
            validate_pdf_input(p)
        self.assertIn("PE/MZ", str(cm.exception))
        self.assertEqual(cm.exception.exit_code, 2)

    def test_elf_and_shebang_signatures_named(self):
        for data, name in ((b"\x7fELF\x02\x01", "ELF"), (b"#!/bin/sh\n", "shebang")):
            p = self.write("x.pdf", data)
            with self.assertRaises(IngestError) as cm:
                validate_pdf_input(p)
            self.assertIn(name, str(cm.exception))

    def test_empty_file_rejected(self):
        p = self.write("empty.pdf", b"")
        with self.assertRaises(IngestError) as cm:
            validate_pdf_input(p)
        self.assertIn("빈 파일", str(cm.exception))

    def test_missing_file_rejected(self):
        with self.assertRaises(IngestError) as cm:
            validate_pdf_input(self.base / "no_such.pdf")
        self.assertIn("없다", str(cm.exception))

    def test_pdf_content_with_txt_extension_warns_but_passes(self):
        # 판정 권한은 내용에 있다 — 확장자 불일치는 경고만 남기고 통과
        p = self.write("actually_pdf.txt", b"%PDF-1.4\n%%EOF")
        warnings = validate_pdf_input(p)
        self.assertEqual(len(warnings), 1)
        self.assertIn("확장자", warnings[0])

    def test_magic_only_accepted_at_offset_zero(self):
        p = self.write("late_header.pdf", b"garbage\n%PDF-1.4\n")
        with self.assertRaises(IngestError):
            validate_pdf_input(p)

    def test_check_pdf_magic_helper(self):
        self.assertIsNone(check_pdf_magic(b"%PDF-"))
        self.assertIn("%PDF-", check_pdf_magic(b"hello"))


class TestParseDefense(_TmpDirTest):
    def _writer_bytes(self, writer) -> bytes:
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()

    def test_encrypted_pdf_rejected(self):
        from pypdf import PdfWriter

        w = PdfWriter()
        w.add_blank_page(width=612, height=792)
        w.encrypt("pw")
        p = self.write("enc.pdf", self._writer_bytes(w))
        with self.assertRaises(IngestError) as cm:
            extract_pages(p, None)
        self.assertIn("암호화", str(cm.exception))
        self.assertEqual(cm.exception.exit_code, 3)

    def test_zero_page_pdf_rejected(self):
        from pypdf import PdfWriter

        p = self.write("zero.pdf", self._writer_bytes(PdfWriter()))
        with self.assertRaises(IngestError) as cm:
            extract_pages(p, None)
        self.assertEqual(cm.exception.exit_code, 3)

    def test_corrupt_pdf_gives_clean_error(self):
        p = self.write("broken.pdf", b"%PDF-1.4\nthis is not a real pdf body")
        with self.assertRaises(IngestError) as cm:
            extract_pages(p, None)
        self.assertEqual(cm.exception.exit_code, 3)
        self.assertNotIn("Traceback", str(cm.exception))


class TestResourceCaps(_TmpDirTest):
    """신뢰 경계 밖 입력(웹 업로드)의 자원 상한 — 페이지 수·렌더 픽셀."""

    def _blank_pdf(self, pages: int, width: int = 612, height: int = 792) -> Path:
        from pypdf import PdfWriter

        w = PdfWriter()
        for _ in range(pages):
            w.add_blank_page(width=width, height=height)
        buf = io.BytesIO()
        w.write(buf)
        return self.write("t.pdf", buf.getvalue())

    def test_page_cap_rejects_before_extraction(self):
        p = self._blank_pdf(4)
        with self.assertRaises(IngestError) as cm:
            extract_pages(p, None, max_pages=3)
        self.assertIn("한도", str(cm.exception))
        self.assertEqual(cm.exception.exit_code, 2)

    def test_page_cap_applies_to_cached_result_too(self):
        p = self._blank_pdf(4)
        cache = self.base / "cache"
        extract_pages(p, cache)  # 상한 없이 캐시 생성
        with self.assertRaises(IngestError):
            extract_pages(p, cache, max_pages=3)

    def test_no_cap_by_default(self):
        p = self._blank_pdf(4)
        self.assertEqual(len(extract_pages(p, None)), 4)

    def test_render_clamps_oversized_mediabox(self):
        # 조작된 초대형 페이지(72,000pt ≈ 1,000인치)는 상한 픽셀로 클램프돼
        # 수 GB 비트맵 할당(OOM)으로 이어지지 않아야 한다
        from PIL import Image

        from loandoc.render import MAX_RENDER_DIM, render_page_png

        p = self._blank_pdf(1, width=72000, height=72000)
        png = render_page_png(p, 1)
        img = Image.open(io.BytesIO(png))
        self.assertLessEqual(max(img.size), MAX_RENDER_DIM)

    def test_render_normal_page_keeps_full_scale(self):
        from PIL import Image

        from loandoc.render import RENDER_SCALE, render_page_png

        p = self._blank_pdf(1)  # letter 612×792pt → 2.0배 ≈ 1224×1584px
        png = render_page_png(p, 1)
        img = Image.open(io.BytesIO(png))
        self.assertLessEqual(abs(img.size[0] - round(612 * RENDER_SCALE)), 2)
        self.assertLessEqual(abs(img.size[1] - round(792 * RENDER_SCALE)), 2)


class TestCliExitCodes(_TmpDirTest):
    def _run(self, pdf_path: Path):
        return subprocess.run(
            [sys.executable, "-m", "loandoc", "classify",
             "--pdf", str(pdf_path), "--out", str(self.base / "out"), "--no-llm"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )

    def test_missing_file_exits_2(self):
        r = self._run(self.base / "no_such.pdf")
        self.assertEqual(r.returncode, 2)
        self.assertIn("입력 거절", r.stderr)

    def test_disguised_exe_exits_2_with_signature(self):
        p = self.write("loan.pdf", b"MZ\x90\x00")
        r = self._run(p)
        self.assertEqual(r.returncode, 2)
        self.assertIn("PE/MZ", r.stderr)

    def test_corrupt_pdf_exits_3(self):
        p = self.write("broken.pdf", b"%PDF-1.4\nnot really")
        r = self._run(p)
        self.assertEqual(r.returncode, 3)
        self.assertIn("입력 거절", r.stderr)


if __name__ == "__main__":
    unittest.main()
