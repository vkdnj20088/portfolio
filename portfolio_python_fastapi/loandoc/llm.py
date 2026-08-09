"""LLM 폴백 분류기 (Anthropic Claude API).

룰 분류기가 확정하지 못한 페이지만 여기로 온다. 텍스트가 충분하면 텍스트로,
희박하거나 없으면(스캔본) 렌더링한 페이지 이미지를 비전 입력으로 보낸다.

재현성 장치:
- 구조화 출력(json_schema)으로 응답 형식을 강제한다.
- 요청 내용 해시를 키로 응답을 로컬 캐시에 저장해, 재실행 시 같은 입력이면
  API 재호출 없이 같은 결과를 쓴다. (5세대 모델은 temperature 등 샘플링
  파라미터를 받지 않아 샘플링 고정이 불가능하므로, 캐시가 실질적 결정성 장치다.)
- 개인정보 보호: 근거(reason)는 서식 문구만 쓰도록 프롬프트로 강제한다.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .rules import LABELS

DEFAULT_MODEL = "claude-sonnet-5"
PROMPT_VERSION = "v1"  # 프롬프트·스키마 변경 시 올려 캐시 무효화
MAX_TEXT_CHARS = 4000

SYSTEM_PROMPT = """\
You classify a single page from a US mortgage loan document package into exactly one category:

- URLA_1003: Uniform Residential Loan Application (Fannie Mae Form 1003 / Freddie Mac Form 65), \
including Lender Loan Information, addenda, and continuation sheets.
- INCOME_DOC: income/employment documents — paystubs, W-2, 1040/1099 tax forms, IRS wage and \
income transcripts, profit and loss statements, verification of employment (VOE) reports, and \
income verification order results.
- CREDIT_REPORT: consumer credit reports (tri-merge), credit score disclosures, and \
risk-based pricing notices.
- TITLE_REPORT: title insurance commitments (ALTA jacket/conditions pages included), \
preliminary title reports (CLTA), chain of title reports, and plat maps attached to title \
documents.
- OTHER: any other document type (e.g. appraisal report, hazard insurance, closing disclosure).

The page may be a scanned image and may be rotated sideways or upside down — read it anyway.
Judge by form layout, headings, and fixed boilerplate, not by personal data.
In "reason", cite only generic form/template phrases; never quote names, SSNs, addresses, \
account numbers, or dollar amounts."""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "enum": list(LABELS)},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason": {"type": "string"},
    },
    "required": ["label", "confidence", "reason"],
    "additionalProperties": False,
}


def _model_params(model: str) -> dict:
    """모델 세대별 지원 파라미터 구성.

    - Opus/Sonnet 5세대와 4.6+ 세대: thinking 비활성 + effort low
      (단순 분류라 사고 과정이 불필요 — 변동성·비용 축소).
    - Haiku 4.5 등 구세대: 두 파라미터를 지원하지 않으므로 생략
      (생략 = thinking 없음). 구조화 출력은 양쪽 모두 지원된다.
    """
    modern = (
        "claude-opus-5", "claude-fable-5", "claude-mythos-5", "claude-sonnet-5",
        "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6",
    )
    params: dict = {
        "output_config": {"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}}
    }
    if model.startswith(modern):
        params["thinking"] = {"type": "disabled"}
        params["output_config"]["effort"] = "low"
    return params


@dataclass
class LlmResult:
    label: str
    confidence: str  # high | medium | low
    reason: str
    model: str
    cached: bool
    usage_input: int = 0   # 실측 비용 산정용 토큰 수
    usage_output: int = 0


class CacheMiss(LookupError):
    """캐시 전용 모드인데 이 입력의 응답이 커밋된 캐시에 없다.

    호출자(classify_pdf)가 잡아서 그 페이지를 룰 판정으로 남긴다 - 키 없는 공개 배포에서
    방문자가 자기 PDF 를 올리는 정상적인 경로이므로, 오류가 아니라 분기다.
    """


class LlmClassifier:
    """LLM 폴백 분류기. **키 없이 캐시만으로도 동작한다**(cache_only).

    캐시 전용 모드가 있는 이유: 공개 배포에는 API 키를 두지 않는다는 원칙을 지키면서도,
    동봉 샘플에 대해서는 *실제로 Claude 가 내린 판정* 을 보여주고 싶기 때문이다. 응답을
    커밋해 두면 키 없는 서버가 그것을 그대로 재생한다 - 캐시가 결정성 장치이자 산출물이다.
    캐시에 없는 입력(방문자가 올린 PDF)은 CacheMiss 로 알리고 룰 판정만 남긴다.
    """

    def __init__(self, model: str = DEFAULT_MODEL, cache_dir: str | Path | None = None,
                 cache_only: bool = False):
        self.model = model
        self.cache_dir = Path(cache_dir) / "llm" if cache_dir else None
        self.cache_only = cache_only
        self._client = None
        if cache_only and self.cache_dir is None:
            raise ValueError("cache_only 모드에는 cache_dir 이 필요하다")

    @property
    def client(self):
        """SDK 클라이언트를 **처음 필요할 때** 만든다.

        생성자에서 만들면 키가 없는 순간 예외라, 캐시만 재생하는 경로까지 막힌다.
        지연 임포트도 같은 이유로 유지한다(--no-llm 실행은 SDK 없이도 되어야 한다)."""
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic()
        return self._client

    def classify(self, text: str | None = None, image_png: bytes | None = None) -> LlmResult:
        if not text and not image_png:
            raise ValueError("text 또는 image_png 중 하나는 필요하다")

        payload = image_png if image_png else text.encode("utf-8")
        key = hashlib.sha256(
            f"{self.model}|{PROMPT_VERSION}|{'img' if image_png else 'txt'}|".encode()
            + payload
        ).hexdigest()

        cache_file = None
        if self.cache_dir is not None:
            cache_file = self.cache_dir / f"{key}.json"
            if cache_file.exists():
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                return LlmResult(**{**data, "cached": True})  # usage 포함 복원

        if self.cache_only:
            # 키가 없는 배포다. API 를 부를 수 없으므로 호출자가 룰 판정으로 남기게 알린다.
            raise CacheMiss(key)

        if image_png:
            content = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.standard_b64encode(image_png).decode(),
                    },
                },
                {"type": "text", "text": "Classify this page."},
            ]
        else:
            content = [
                {
                    "type": "text",
                    "text": "Extracted text of the page:\n\n"
                    + text[:MAX_TEXT_CHARS]
                    + "\n\nClassify this page.",
                }
            ]

        response = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            **_model_params(self.model),
        )

        if response.stop_reason == "refusal":
            # 안전 분류기 거절 — 대출 서류에선 드물지만 방어적으로 처리.
            # 일시적일 수 있으므로 캐시하지 않는다(재실행 시 재시도).
            return LlmResult("OTHER", "low", "model refused to classify", self.model, False)
        if response.stop_reason != "end_turn":
            raise RuntimeError(
                f"LLM 응답 비정상 종료(stop_reason={response.stop_reason}) — "
                "max_tokens 도달 시 JSON이 잘렸을 수 있다"
            )

        # 구조화 출력이 형식을 강제하지만, 응답 구성이 예상과 다를 때 원인
        # 불명의 트레이스백 대신 진단 가능한 에러를 내도록 방어한다.
        text_block = next((b.text for b in response.content if b.type == "text"), None)
        if text_block is None:
            raise RuntimeError("LLM 응답에 텍스트 블록이 없다 — 응답 구성이 예상과 다르다")
        try:
            data = json.loads(text_block)
        except ValueError as e:
            raise RuntimeError(f"LLM 구조화 출력이 유효한 JSON이 아니다: {e}") from e
        result = LlmResult(
            data["label"], data["confidence"], data["reason"], self.model, False,
            usage_input=response.usage.input_tokens,
            usage_output=response.usage.output_tokens,
        )

        if cache_file is not None:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(
                json.dumps(
                    {
                        "label": result.label,
                        "confidence": result.confidence,
                        "reason": result.reason,
                        "model": result.model,
                        "usage_input": result.usage_input,
                        "usage_output": result.usage_output,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        return result
