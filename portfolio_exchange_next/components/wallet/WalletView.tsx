"use client";
import { useState } from "react";
import { COINS } from "@/lib/mock/data";
import { formatQty } from "@/lib/format";
import { sanitizeDecimalInput } from "@/lib/inputSanitize";
type Mode = "deposit" | "withdraw";
const NETWORKS: Record<string, string[]> = { BTC: ["Bitcoin"], ETH: ["Ethereum", "Arbitrum"], XRP: ["XRP Ledger"], SOL: ["Solana"], DOGE: ["Dogecoin"] };
const MOCK_QTY: Record<string, number> = { BTC: 0.1523, ETH: 2.1, XRP: 4200, SOL: 12.4, DOGE: 0 };
const MOCK_ADDR = "0xDE3Ab...9f21c4 (데모 주소)";
export default function WalletView() {
  const [coin, setCoin] = useState("BTC");
  const [mode, setMode] = useState<Mode>("deposit");
  const [network, setNetwork] = useState(NETWORKS["BTC"][0]);
  const [addr, setAddr] = useState(""); const [amount, setAmount] = useState("");
  const nets = NETWORKS[coin] ?? [];
  const pickCoin = (c: string) => { setCoin(c); setNetwork((NETWORKS[c] ?? [""])[0]); };
  return (
    <div className="wallet-page">
      <h1 className="page-h1">입출금</h1>
      <div className="wallet-grid">
        <aside className="wallet-assets">
          <div className="wa-head">보유 자산</div>
          <ul>{COINS.map((c) => (
            <li key={c.id} className={c.id === coin ? "on" : ""} onClick={() => pickCoin(c.id)}>
              <span className="wa-name"><b>{c.name}</b><em>{c.id}</em></span>
              <span className="wa-qty num">{formatQty(MOCK_QTY[c.id] ?? 0, 4)}</span>
            </li>))}</ul>
        </aside>
        <section className="wallet-form">
          <div className="wf-tabs">
            <button className={mode === "deposit" ? "on" : ""} onClick={() => setMode("deposit")}>입금</button>
            <button className={mode === "withdraw" ? "on" : ""} onClick={() => setMode("withdraw")}>출금</button>
          </div>
          <div className="wf-coin">
            <span className="wf-badge">{coin}</span>
            <div><b>{COINS.find((c) => c.id === coin)?.name}</b>
              <span className="wf-avail num">출금가능 {formatQty(MOCK_QTY[coin] ?? 0, 4)} {coin}</span></div>
          </div>
          {nets.length > 1 && (
            <label className="wf-row"><span>네트워크</span>
              <select value={network} onChange={(e) => setNetwork(e.target.value)}>
                {nets.map((n) => (<option key={n}>{n}</option>))}
              </select></label>
          )}
          {mode === "deposit" ? (
            <div className="wf-deposit">
              <p className="wf-label">입금 주소 ({network})</p>
              <div className="wf-addrbox"><code className="num">{MOCK_ADDR}</code>
                <button onClick={() => alert("[데모] 주소 복사됨")}>복사</button></div>
              <div className="wf-qr" aria-label="QR 코드(데모)">
                <div className="qr-grid">{Array.from({ length: 64 }, (_, i) => (<i key={i} data-on={(i * 7 + (i % 5) * 13) % 3 === 0} />))}</div>
              </div>
              <p className="wf-warn">· 반드시 <b>{network}</b> 네트워크로만 입금하세요. (데모 안내)</p>
            </div>
          ) : (
            <div className="wf-withdraw">
              <label className="wf-row"><span>출금 주소</span>
                <input value={addr} placeholder="받는 주소 입력" onChange={(e) => setAddr(e.target.value)} /></label>
              <label className="wf-row"><span>출금 수량</span>
                <input className="num" inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))} /></label>
              <div className="wf-pcts">{[25, 50, 100].map((p) => (
                <button key={p} onClick={() => setAmount(String(+(((MOCK_QTY[coin] ?? 0) * p) / 100).toFixed(4)))}>{p}%</button>))}</div>
              <dl className="wf-fee num">
                <div><dt>수수료</dt><dd>0.0005 {coin}</dd></div>
                <div><dt>실 수령</dt><dd>{Math.max(0, (+amount || 0) - 0.0005).toFixed(4)} {coin}</dd></div>
              </dl>
              <button className="wf-submit" onClick={() => alert("[데모] OTP 인증 후 출금 신청")}>출금 신청</button>
              <p className="wf-warn">· 출금 시 OTP 인증이 필요합니다. (데모)</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
