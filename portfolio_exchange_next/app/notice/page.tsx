const NOTICES = [
  { d: "2026-02-01", t: "USDT 마켓 신규 오픈 안내 (데모)" },
  { d: "2026-01-24", t: "정기 점검에 따른 일부 서비스 일시 중단 (데모)" },
  { d: "2026-01-15", t: "신규 상장 코인 거래 지원 안내 (데모)" },
];
export default function NoticePage() {
  return (
    <div className="simple-page">
      <h1 className="page-h1">공지사항</h1>
      <ul className="notice-list">
        {NOTICES.map((n) => (
          <li key={n.d}><span className="nt-title">{n.t}</span><time className="num">{n.d}</time></li>
        ))}
      </ul>
      <p className="mock-note">· 데모용 예시 공지입니다. (실서비스 아님)</p>
    </div>
  );
}
