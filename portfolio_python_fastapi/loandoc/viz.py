"""분류 결과 시각화 (정적 PNG).

- 페이지 타임라인 스트립: 셀 하나가 한 페이지, 색 = 유형. 색만으로 구분하지
  않도록 셀 안에 유형 이니셜을 함께 새긴다(색각이상·저대비 대비 보조 인코딩).
- 유형별 분포 막대: 페이지 수 집계.
- 팔레트는 색각이상 검증기(dataviz validate_palette, all-pairs 모드)를 통과한
  5색 조합을 라벨별로 고정 배정했다. 재실행해도 동일한 PNG가 나온다.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from .classify import PageRecord

LABEL_COLORS = {
    "URLA_1003": "#2a78d6",     # blue
    "INCOME_DOC": "#eda100",    # yellow
    "CREDIT_REPORT": "#1baf7a", # aqua
    "TITLE_REPORT": "#4a3aa7",  # violet
    "OTHER": "#e34948",         # red
}
LABEL_INITIAL = {
    "URLA_1003": "U",
    "INCOME_DOC": "I",
    "CREDIT_REPORT": "C",
    "TITLE_REPORT": "T",
    "OTHER": "O",
}

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRID = "#e1e0d9"
BASELINE = "#c3c2b7"

# 한글 제목·라벨용 폰트: 설치된 것만 골라 지정(미설치 폰트 경고 방지)
_KOREAN_FONTS = ["Apple SD Gothic Neo", "AppleGothic", "NanumGothic", "Malgun Gothic"]
_available = {f.name for f in matplotlib.font_manager.fontManager.ttflist}
plt.rcParams["font.family"] = [f for f in _KOREAN_FONTS if f in _available] + ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def _cell_text_color(hex_color: str) -> str:
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return "#ffffff" if luma < 0.55 else INK


def render_viz(out_path: str | Path, pdf_name: str, records: list[PageRecord]) -> None:
    n = len(records)
    fig_w = max(10.0, n * 0.30)
    fig, (ax_strip, ax_bar) = plt.subplots(
        2, 1, figsize=(fig_w, 4.6), height_ratios=[1.5, 1.0],
        facecolor=SURFACE, constrained_layout=True,
    )

    # ── 페이지 타임라인 스트립 ───────────────────────────────────
    ax_strip.set_facecolor(SURFACE)
    for r in records:
        color = LABEL_COLORS[r.label]
        ax_strip.bar(r.page, 1.0, width=0.86, bottom=0, color=color, edgecolor="none")
        ax_strip.text(
            r.page, 0.5, LABEL_INITIAL[r.label], ha="center", va="center",
            fontsize=8, color=_cell_text_color(color),
        )
        if r.stage == "llm":
            ax_strip.plot(r.page, -0.22, marker="o", markersize=3.4, color=INK,
                          markeredgecolor="none")
        elif r.stage == "rule_lowconf":
            ax_strip.plot(r.page, -0.22, marker="o", markersize=3.4,
                          markerfacecolor="none", markeredgecolor=INK,
                          markeredgewidth=0.9)
        ax_strip.text(r.page, -0.52, str(r.page), ha="center", va="top",
                      fontsize=5.8, color=INK_MUTED)

    ax_strip.set_xlim(0.4, n + 0.6)
    ax_strip.set_ylim(-0.8, 1.25)
    ax_strip.axis("off")
    ax_strip.set_title(
        f"{pdf_name} — 페이지 유형 타임라인",
        fontsize=12, color=INK, loc="left", pad=10,
    )
    ax_strip.text(
        0.4, 1.16,
        "셀 1개 = 1페이지 · 문자 = 유형 이니셜 · ● = LLM 폴백 판정 · ○ = 룰 저신뢰 추정",
        fontsize=7.5, color=INK_MUTED, va="bottom",
    )

    # ── 유형별 분포 막대 ─────────────────────────────────────────
    ax_bar.set_facecolor(SURFACE)
    counts = {label: 0 for label in LABEL_COLORS}
    for r in records:
        counts[r.label] += 1
    present = [(label, c) for label, c in counts.items() if c > 0]
    ys = range(len(present))
    for y, (label, c) in zip(ys, present):
        ax_bar.barh(y, c, height=0.55, color=LABEL_COLORS[label], edgecolor="none")
        ax_bar.text(c + n * 0.008, y, str(c), va="center", fontsize=9,
                    color=INK_SECONDARY)
    ax_bar.set_yticks(list(ys))
    ax_bar.set_yticklabels([label for label, _ in present], fontsize=8.5, color=INK)
    ax_bar.invert_yaxis()
    ax_bar.set_xlim(0, max(c for _, c in present) * 1.15)
    ax_bar.tick_params(axis="x", labelsize=7.5, colors=INK_MUTED, length=0)
    ax_bar.tick_params(axis="y", length=0)
    ax_bar.grid(axis="x", color=GRID, linewidth=0.7)
    ax_bar.set_axisbelow(True)
    for spine in ("top", "right", "left"):
        ax_bar.spines[spine].set_visible(False)
    ax_bar.spines["bottom"].set_color(BASELINE)
    ax_bar.set_title("유형별 페이지 수", fontsize=10.5, color=INK, loc="left", pad=6)

    # 범례 (색 + 이니셜 병기)
    handles = [
        Patch(facecolor=LABEL_COLORS[label], label=f"{LABEL_INITIAL[label]} · {label}")
        for label, c in present
    ]
    ax_strip.legend(
        handles=handles, loc="upper left", bbox_to_anchor=(0.0, -0.32),
        ncol=min(5, len(handles)), frameon=False, fontsize=7.5,
        handlelength=1.1, handleheight=1.1, labelcolor=INK_SECONDARY,
    )

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=200, facecolor=SURFACE)
    plt.close(fig)
