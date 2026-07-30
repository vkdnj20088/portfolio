"use client";
import { useMarketFeed } from "@/store/marketStore";
import { formatKRW } from "@/lib/format";
import type { Level, MarketSnapshot } from "@/lib/mock/data";

/**
 * 뎁스 차트(#E2) - 누적 호가를 계단 면적으로 그린다.
 *
 * <h2>왜 필요한가</h2>
 * 호가창은 20단의 숫자를 보여 주지만 <b>유동성이 어느 쪽으로 기울어 있는지</b>는 숫자를 눈으로
 * 더해야 알 수 있다. 누적값은 이미 계산하고 있다(호가 막대의 폭) - 같은 값을 다른 관점으로 한 번
 * 더 제시하면 "데이터를 계산했다"에서 "데이터를 여러 관점으로 제시한다"로 올라간다.
 *
 * <h2>왜 lightweight-charts 를 쓰지 않았나</h2>
 * 이미 캔들 차트가 그 라이브러리를 쓰지만, 두 번째 인스턴스는 초당 갱신되는 화면에 캔버스와
 * 자체 rAF 루프를 하나 더 얹는다. 뎁스는 점이 40개인 <b>계단 두 개</b>라 SVG path 두 줄로 끝난다 -
 * 라이브러리를 쓸 이유가 크기가 아니라 익숙함뿐이면 쓰지 않는 편이 낫다.
 *
 * <h2>색</h2>
 * 한국식 등락색을 따른다: 매수(bid) = 빨강(--up), 매도(ask) = 파랑(--down). 이 화면의 다른
 * 요소와 같은 규칙이라 색만 보고도 어느 쪽인지 읽힌다.
 */

/** 좌표계는 viewBox 고정(0..100 × 0..100)이고 CSS 가 실제 크기를 정한다 - 리사이즈 리스너가 필요 없다. */
const W = 100;
const H = 100;

/**
 * 누적 계단 경로. 가격을 x, 누적 수량을 y 로 놓고 각 단에서 수직으로 올라간다.
 * 계단(step)으로 그리는 이유: 호가는 연속 함수가 아니라 이산 단계이고, 선형 보간은 존재하지 않는
 * 중간 가격에 유동성이 있는 것처럼 보이게 한다 - 데이터를 왜곡하지 않는 표현을 고른다.
 *
 * @param toX 가격 -> x 매핑(매수는 오른쪽에서 왼쪽으로 멀어지므로 방향이 반대다)
 */
function stepPath(levels: Level[], maxCum: number, toX: (price: number) => number): string {
  if (levels.length === 0 || maxCum <= 0) return "";
  const pts: string[] = [];
  let running = 0;
  let prevX = toX(levels[0].price);
  pts.push(`M ${prevX.toFixed(2)} ${H}`);
  for (const l of levels) {
    running += l.size;
    const x = toX(l.price);
    const y = H - (running / maxCum) * H;
    // 이전 x 에서 새 y 로 수직 이동 -> 새 x 로 수평 이동(계단).
    pts.push(`L ${prevX.toFixed(2)} ${y.toFixed(2)}`);
    pts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    prevX = x;
  }
  pts.push(`L ${prevX.toFixed(2)} ${H}`, "Z");
  return pts.join(" ");
}

function cumTotal(levels: Level[]): number {
  return levels.reduce((a, l) => a + l.size, 0);
}

export default function DepthChart({ market, initial }: { market: string; initial: MarketSnapshot }) {
  const snap = useMarketFeed(market, initial)!;
  const { asks, bids } = snap.orderbook;
  if (asks.length === 0 || bids.length === 0) return null;

  // 양쪽 누적 최대를 같은 축으로 쓴다. 각자 정규화하면 두 면적이 늘 같은 높이로 보여
  // 불균형이라는 이 차트의 유일한 메시지가 사라진다.
  const maxCum = Math.max(cumTotal(asks), cumTotal(bids));

  // x 축은 현재가를 중앙에 두고 양쪽으로 같은 가격 폭을 잡는다. 폭을 호가 범위로 맞추면
  // 한쪽이 촘촘할 때 중앙이 어긋나 "현재가가 중앙"이라는 읽기 규칙이 깨진다.
  const mid = snap.price;
  const span = Math.max(
    Math.abs(asks[asks.length - 1].price - mid),
    Math.abs(mid - bids[bids.length - 1].price),
  ) || 1;
  const askX = (p: number) => W / 2 + ((p - mid) / span) * (W / 2);
  const bidX = (p: number) => W / 2 - ((mid - p) / span) * (W / 2);

  const askPath = stepPath(asks, maxCum, askX);
  const bidPath = stepPath(bids, maxCum, bidX);
  const bidTotal = cumTotal(bids);
  const askTotal = cumTotal(asks);
  const skew = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : 50;

  return (
    <section className="depth" aria-label="누적 호가(뎁스)">
      <div className="depth-head">
        <h2 className="panel-title">뎁스</h2>
        {/* 수치를 텍스트로 함께 준다 - 차트는 보조 표현이고, 스크린리더와 색각 이상 사용자에게는
            이 문장이 유일한 경로다(차트 자체는 aria-hidden). */}
        <p className="depth-skew num" role="status" aria-live="off">
          매수 우위 <b>{skew.toFixed(0)}%</b>
          <span className="depth-sub">
            매수 누적 {formatKRW(Math.round(bidTotal * 10000) / 10000)} · 매도 누적{" "}
            {formatKRW(Math.round(askTotal * 10000) / 10000)}
          </span>
        </p>
      </div>
      <svg
        className="depth-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path className="depth-bid" d={bidPath} />
        <path className="depth-ask" d={askPath} />
        {/* 현재가 기준선 - 두 면적의 경계가 어디인지 보여 준다. */}
        <line className="depth-mid" x1={W / 2} y1="0" x2={W / 2} y2={H} />
      </svg>
      <div className="depth-axis num" aria-hidden="true">
        <span>{formatKRW(bids[bids.length - 1].price)}</span>
        <span>{formatKRW(mid)}</span>
        <span>{formatKRW(asks[asks.length - 1].price)}</span>
      </div>
    </section>
  );
}
