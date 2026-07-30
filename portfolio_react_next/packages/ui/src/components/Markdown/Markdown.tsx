import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type InlineToken } from '../../lib/miniMarkdown';
import styles from './Markdown.module.css';

/**
 * 마크다운 최소 서브셋 렌더러(#C1).
 *
 * <h2>안전 경계</h2>
 * HTML 문자열을 DOM 에 주입하는 React 이스케이프 해제 경로를 <b>전혀 쓰지 않는다</b>.
 * 파서가 만든 토큰을 React 요소로 직접 조립하므로 문자열이 HTML 로 해석되는 경로가 존재하지
 * 않는다 - 이스케이프를 "잊을" 수 있는 자리가 없다는 뜻이다. sanitize 함수를 신뢰하는 대신
 * <b>구조적으로</b> 막는다.
 *
 * <p>링크는 파서가 스킴을 검증한 것만 넘어오지만, 여기서도 `rel="noopener noreferrer"` 와
 * `target="_blank"` 를 외부 링크에만 붙인다(내부 앵커/경로는 같은 탭이 자연스럽다).
 * `noopener` 없이 새 탭을 열면 열린 페이지가 `window.opener` 로 이 앱을 조작할 수 있다.
 */
export interface MarkdownProps {
  children: string;
  /** 추가 클래스(레이아웃 맞춤용). */
  className?: string;
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case 'code':
        return (
          <code key={i} className={styles.inlineCode}>
            {t.text}
          </code>
        );
      case 'strong':
        return <strong key={i}>{t.text}</strong>;
      case 'em':
        return <em key={i}>{t.text}</em>;
      case 'link':
        return isExternal(t.href) ? (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            {t.text}
          </a>
        ) : (
          <a key={i} href={t.href} className={styles.link}>
            {t.text}
          </a>
        );
      default:
        // text - React 가 문자열을 이스케이프한다. 여기가 HTML 이 될 수 있었던 유일한 후보였고,
        // 문자열을 자식으로 넘기는 것으로 그 가능성이 사라진다.
        return <Fragment key={i}>{t.text}</Fragment>;
    }
  });
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case 'codeBlock':
      return (
        // 언어는 표시만 한다 - 하이라이팅은 넣지 않았다. 토크나이저를 하나 더 들이는 비용보다
        // "코드임이 구분된다"는 목적이 먼저이고, 색이 없어도 그 목적은 달성된다.
        <pre key={key} className={styles.pre} data-lang={b.lang ?? undefined}>
          <code>{b.text}</code>
        </pre>
      );
    case 'list':
      return (
        <ul key={key} className={styles.list}>
          {b.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    default:
      return (
        <p key={key} className={styles.p}>
          {renderInline(b.inline)}
        </p>
      );
  }
}

export function Markdown({ children, className }: MarkdownProps) {
  const blocks = parseMarkdown(children);
  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      {blocks.map(renderBlock)}
    </div>
  );
}
