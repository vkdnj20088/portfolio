# loandoc 웹 서비스 컨테이너.
# 빌드:  docker build -t loandoc .
# 실행:  docker run --rm -p 8000:8000 -e ANTHROPIC_API_KEY=... loandoc
#        (키 없이 실행하면 LLM 폴백 없이 룰 단독으로 동작)
FROM python:3.13-slim

# 시각화의 한글 라벨용 폰트 (viz.py의 폰트 후보에 NanumGothic 포함)
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-web.txt ./
RUN pip install --no-cache-dir -r requirements-web.txt

COPY loandoc/ loandoc/
COPY webapp/ webapp/

# 비루트 실행 — 파서가 공격 표면인 서비스라 프로세스 권한을 낮춰 둔다.
# 홈 디렉토리는 matplotlib 설정 캐시용, 8000은 비특권 포트라 문제 없다.
RUN useradd --create-home --uid 10001 loandoc
USER loandoc

# 데이터·캐시는 이미지에 포함하지 않는다 — 데이터는 요청 본문으로만 받는다
EXPOSE 8000
CMD ["uvicorn", "webapp.app:app", "--host", "0.0.0.0", "--port", "8000"]
