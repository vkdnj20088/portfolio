"""웹 서비스 래퍼 스모크 테스트.

합성 PDF(빈 페이지)만 사용 — 외부 데이터 불필요. fastapi 미설치 환경(핵심
requirements.txt만 설치)에서는 자동 스킵된다.
"""

import io
import unittest

try:
    from fastapi.testclient import TestClient

    from webapp.app import app

    HAVE_WEB = True
except ImportError:
    HAVE_WEB = False


def _pdf_bytes(pages: int = 2) -> bytes:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@unittest.skipUnless(HAVE_WEB, "fastapi 미설치 — requirements-web.txt 필요")
class TestWebApp(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_healthz(self):
        res = self.client.get("/healthz")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")

    def test_classify_rules_only(self):
        res = self.client.post(
            "/api/classify?llm=off",
            files={"file": ("t.pdf", _pdf_bytes(2), "application/pdf")},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["num_pages"], 2)
        self.assertFalse(data["llm_used"])
        # 빈 페이지 = 시그니처 무신호 → OTHER 저신뢰 추정
        self.assertEqual(data["label_distribution"], {"OTHER": 2})
        self.assertEqual(data["pages"][0]["stage"], "rule_lowconf")

    def test_include_viz(self):
        res = self.client.post(
            "/api/classify?llm=off&include_viz=true",
            files={"file": ("t.pdf", _pdf_bytes(1), "application/pdf")},
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["viz_png_base64"].startswith("iVBOR"))  # PNG 매직

    def test_rejects_non_pdf(self):
        res = self.client.post(
            "/api/classify",
            files={"file": ("t.txt", b"not a pdf", "text/plain")},
        )
        self.assertEqual(res.status_code, 415)

    def test_rejects_disallowed_model(self):
        # 키가 설정된 배포에서 호출자가 임의 모델로 비용을 키우지 못해야 한다
        res = self.client.post(
            "/api/classify?model=claude-opus-5",
            files={"file": ("t.pdf", _pdf_bytes(1), "application/pdf")},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("허용", res.json()["detail"])

    def test_rejects_over_page_cap(self):
        from webapp.app import MAX_UPLOAD_PAGES

        res = self.client.post(
            "/api/classify?llm=off",
            files={"file": ("big.pdf", _pdf_bytes(MAX_UPLOAD_PAGES + 1),
                            "application/pdf")},
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("한도", res.json()["detail"])

    def test_edge_filename_falls_back_to_fixed_name(self):
        # ".." 같은 파일명이 파일 생성 실패(500)로 새지 않아야 한다
        res = self.client.post(
            "/api/classify?llm=off",
            files={"file": ("..", _pdf_bytes(1), "application/pdf")},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["pdf"], "upload.pdf")

    def _index_without_key(self, cache: bool):
        """키 없는 랜딩을 캐시 유무별로 받아 온다.

        캐시 존재 여부를 커밋된 demo/llm-cache 의 현재 상태에 맡기지 않는다 - 산출물을
        생성하기 전과 후에 이 판정이 뒤집히면, 화면 문구를 지키려던 테스트가 산출물
        유무를 알려 주는 테스트로 바뀐다.
        """
        import os
        from pathlib import Path
        from unittest.mock import patch

        from webapp import app as webapp

        target = webapp.DEMO_CACHE_DIR if cache else Path("/nonexistent-llm-cache")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ANTHROPIC_API_KEY", None)
            with patch.object(webapp, "DEMO_CACHE_DIR", target):
                return self.client.get("/")

    def test_index_page_identity_and_notice(self):
        # 귀속 → 역할 → 데모 고지 위계가 화면에 있어야 한다(다른 데모와 통일).
        res = self._index_without_key(cache=False)
        self.assertEqual(res.status_code, 200)
        self.assertIn("JC LoanDoc", res.text)
        self.assertIn("최종은의 Python + FastAPI 포트폴리오", res.text)
        self.assertIn("IT 경력 12년+", res.text)
        self.assertIn("실서비스가 아닌 데모", res.text)
        # 키도 캐시도 없는 배포: 끌 것이 없으므로 토글을 감추고 룰 단독임을 밝힌다
        self.assertNotIn('id="nollm"', res.text)
        self.assertIn("룰 단독", res.text)

    def test_index_page_with_cache_announces_replay(self):
        # 키는 없지만 커밋된 응답이 있는 배포(포트폴리오 기본). 재생임을 화면이 직접 말하고,
        # 룰 단독과 나란히 비교할 수 있게 토글은 남긴다.
        res = self._index_without_key(cache=True)
        self.assertIn("실제 Claude", res.text)
        self.assertIn("재생", res.text)
        self.assertIn("룰 단독", res.text)  # 방문자 PDF 는 캐시에 없다는 경계도 함께
        self.assertIn('id="nollm"', res.text)

    def test_index_page_with_key_shows_llm_toggle(self):
        import os
        from unittest.mock import patch

        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
            res = self.client.get("/")
        self.assertIn('id="nollm"', res.text)

    def test_sample_pdf_and_report(self):
        res = self.client.get("/sample.pdf")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.content.startswith(b"%PDF-"))
        res = self.client.get("/report")
        self.assertEqual(res.status_code, 200)
        self.assertIn("demo_package.pdf", res.text)


if __name__ == "__main__":
    unittest.main()
