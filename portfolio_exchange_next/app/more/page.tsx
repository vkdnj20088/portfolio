import ThemeToggle from "@/components/common/ThemeToggle";
const MENUS = ["마이페이지", "본인인증 (KYC)", "로그인 기록", "고객지원", "이용약관", "글자 크기 설정"];
export default function MorePage() {
  return (
    <div className="simple-page">
      <h1 className="page-h1">더보기</h1>
      <div className="more-theme">
        <span>화면 테마</span><ThemeToggle />
      </div>
      <ul className="more-list">
        {MENUS.map((m) => (<li key={m}>{m}<span aria-hidden="true">›</span></li>))}
      </ul>
      <p className="mock-note">· 접근성(다크모드·글자크기) 기여를 시연하는 데모 메뉴입니다. (실서비스 아님)</p>
    </div>
  );
}
