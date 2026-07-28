"use client";
import Link from "next/link";
import { COINS } from "@/lib/mock/data";
import { useMarketFeed } from "@/store/marketStore";
import { formatKRW, formatRate } from "@/lib/format";
function Row({ id, name, active }: { id: string; name: string; active: boolean }) {
  const snap = useMarketFeed(id);
  const dir = !snap ? "" : snap.changeRate > 0 ? "up" : snap.changeRate < 0 ? "down" : "";
  return (
    <li className={active ? "active" : ""}>
      <Link href={`/exchange/${id}`}>
        <span className="cl-name"><b>{name}</b><em>{id}/KRW</em></span>
        <span className={`cl-price num ${dir}`}>{snap ? formatKRW(snap.price) : "–"}</span>
        <span className={`cl-rate num ${dir}`}>{snap ? formatRate(snap.changeRate) : "–"}</span>
      </Link>
    </li>
  );
}
export default function CoinList({ current }: { current: string }) {
  return (
    <section className="coin-list">
      <div className="cl-tabs"><button className="on">KRW</button><button>USDT</button><button>BTC</button></div>
      <ul>{COINS.map((c) => (<Row key={c.id} id={c.id} name={c.name} active={c.id === current} />))}</ul>
    </section>
  );
}
