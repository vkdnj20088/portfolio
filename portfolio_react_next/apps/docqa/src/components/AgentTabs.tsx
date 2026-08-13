'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 실행 되짚기와 평가를 오가는 세그먼트.
 *
 * 상단바 내비를 넷에서 다섯으로 늘리지 않는다. 두 화면은 **같은 데이터를 다르게 보는 것**이라
 * (실행 하나 vs 실행 여럿) 한 지붕 아래가 맞고, 승격이 두 화면 사이를 오간다 - 실행 뷰의
 * span 에서 케이스를 만들고, 평가 뷰의 케이스에서 원본 span 으로 되돌아간다.
 * IP 접근 제어 데모가 세 화면을 세그먼트로 나눈 것과 같은 이유다.
 */
export function AgentTabs() {
  const pathname = usePathname();
  const onEval = pathname.startsWith('/agent/eval');
  return (
    <nav className="agentTabs" aria-label="에이전트 화면">
      <Link
        href="/agent"
        className={onEval ? '' : 'isOn'}
        aria-current={onEval ? undefined : 'page'}
      >
        실행 되짚기
      </Link>
      <Link
        href="/agent/eval"
        className={onEval ? 'isOn' : ''}
        aria-current={onEval ? 'page' : undefined}
      >
        회귀인가 잡음인가
      </Link>
    </nav>
  );
}
