export interface Metric {
  /** 지표 이름. */
  k: string;
  /** 표시 값. */
  v: string;
  tone?: 'ok' | 'muted';
}

/**
 * 관측 지표 스트립. 데모가 "그럴듯해 보이는" 데서 멈추지 않도록, 매 응답의 실제 수치
 * (파이프라인 단계별 후보 수 · 검색 지연 · 실제로 서빙한 전송 · 근거 축자 검증)를 화면에 그대로 노출한다.
 *
 * 설명은 title 툴팁이 아니라 note 로 화면에 적는다 - 툴팁은 키보드·터치·스크린리더 사용자에게
 * 아예 보이지 않아서, 폴백 사유 같은 "숨기면 안 되는 정보"를 담을 자리가 못 된다.
 * dl/dt/dd 는 암묵 role 이 없어 aria-label 이 무시될 수 있으므로 role="group" 으로 이름을 붙인다.
 */
export function Metrics({ items, label, note }: { items: Metric[]; label: string; note?: string }) {
  return (
    <div className="metricsBox">
      <dl className="metrics" role="group" aria-label={label}>
        {items.map((m) => (
          <div className="metric" key={m.k}>
            <dt>{m.k}</dt>
            <dd className={m.tone ?? ''}>{m.v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="metricsNote">{note}</p>}
    </div>
  );
}
