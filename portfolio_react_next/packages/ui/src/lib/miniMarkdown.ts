/**
 * 마크다운 **최소 서브셋** 파서(#C1) - 토큰 목록만 만들고 렌더는 하지 않는다.
 *
 * <h2>왜 라이브러리를 쓰지 않았나</h2>
 * marked/remark 는 raw HTML 을 지원하고, 그 지원을 끄는 것이 이 작업의 어려운 부분이 된다
 * (sanitize 라이브러리를 하나 더 붙이고 두 설정의 교집합을 관리해야 한다). 필요한 문법이
 * 다섯 개뿐이면 <b>지원하지 않는 것을 애초에 파싱하지 않는</b> 쪽이 안전 경계가 훨씬 좁다.
 *
 * <h2>안전 모델 - 허용목록이 아니라 미지원</h2>
 * raw HTML 을 "걸러내지" 않는다. **파싱하지 않는다.** 파서가 만들 수 있는 토큰이
 * text/code/strong/em/link/listItem/codeBlock 뿐이라, HTML 문자열은 어떤 경로로도 태그가
 * 되지 못하고 text 토큰의 내용으로만 남는다(React 가 텍스트로 이스케이프한다).
 * 필터는 우회 대상을 찾는 게임이고, 미지원은 게임 자체가 없다.
 *
 * <p>링크는 스킴 화이트리스트로 막는다 - `javascript:`·`data:`·`vbscript:` 는 링크가 아니라
 * 텍스트로 강등한다. 상대 경로와 앵커는 허용한다(같은 앱 안의 이동이다).
 *
 * <h2>CSP 와의 관계</h2>
 * 이 앱은 요청별 nonce CSP + strict-dynamic 을 쓴다. 즉 인라인 스크립트는 CSP 가 이미 막는다.
 * 그럼에도 파서에서 또 막는 이유는 <b>두 겹</b>이기 때문이다 - CSP 는 브라우저가 지켜 주는
 * 방어선이고 파서는 우리가 지키는 방어선이다. CSP 설정을 누가 완화하는 날 파서가 남고,
 * 파서에 구멍이 나는 날 CSP 가 남는다. 어느 한 겹만 있으면 그날 뚫린다.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'codeBlock'; lang: string | null; text: string }
  | { kind: 'list'; items: InlineToken[][] };

/** 링크에 허용하는 스킴. 그 밖(javascript:, data:, vbscript: 등)은 링크로 만들지 않는다. */
const SAFE_SCHEME = /^(https?:\/\/|mailto:|\/|#)/i;

/**
 * 인라인 문법 매처. 순서가 우선순위다 - <b>코드가 먼저</b>여야 한다.
 * `` `**a**` `` 는 코드 안의 별표이지 강조가 아니고, 강조를 먼저 처리하면 원문이 바뀌어
 * 코드 블록의 존재 이유(원문 보존)가 사라진다.
 */
const INLINE = /(`[^`\n]+`)|(\[[^\]\n]*\]\([^)\s]*\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;

/**
 * 인라인 파싱 - 매치와 매치 사이 평문을 번갈아 담는다.
 *
 * 토큰 종류를 <b>어느 캡처 그룹이 찼는지</b>로 정한다. 매치 문자열의 첫 글자를 보고 나누면
 * `**`(strong)와 `*`(em)의 판정이 검사 순서에 묶여, 위 정규식의 순서를 바꾸는 날 조용히
 * 어긋난다. 캡처 번호는 정규식과 한 곳에 붙어 있어 그럴 자리가 없다.
 *
 * 글자 유실은 커서(`cursor`)로 막는다 - 매치 앞 구간과 마지막 매치 뒤 구간을 반드시 담고,
 * "토큰 텍스트를 이으면 원문에서 마크업 기호만 빠진 형태"라는 성질을 테스트로 못박아 둔다.
 */
export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let cursor = 0;

  for (const m of src.matchAll(INLINE)) {
    const raw = m[0];
    if (m.index > cursor) out.push({ kind: 'text', text: src.slice(cursor, m.index) });
    cursor = m.index + raw.length;

    if (m[1] !== undefined) {
      out.push({ kind: 'code', text: raw.slice(1, -1) });
    } else if (m[2] !== undefined) {
      const close = raw.indexOf('](');
      const text = raw.slice(1, close);
      const href = raw.slice(close + 2, -1);
      if (SAFE_SCHEME.test(href)) {
        // 링크 문구가 비면 주소를 문구로 쓴다(빈 링크는 키보드로 도달만 되고 읽히지 않는다).
        out.push({ kind: 'link', text: text || href, href });
      } else {
        // 허용하지 않는 스킴 - 링크로 만들지 않고 원문을 그대로 보여 준다. 조용히 삼키면
        // 사용자는 링크가 있었다는 사실조차 모른다.
        out.push({ kind: 'text', text: raw });
      }
    } else if (m[3] !== undefined) {
      out.push({ kind: 'strong', text: raw.slice(2, -2) });
    } else {
      out.push({ kind: 'em', text: raw.slice(1, -1) });
    }
  }

  if (cursor < src.length) out.push({ kind: 'text', text: src.slice(cursor) });
  return out.length > 0 ? out : [{ kind: 'text', text: src }];
}

const FENCE_OPEN = /^```(\w*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;

/**
 * 블록 파싱. 지원: 코드 펜스(```), 불릿 목록(- / *), 문단.
 *
 * 닫히지 않은 펜스는 <b>끝까지 코드로</b> 취급한다 - 스트리밍 중에는 항상 그 상태를 지나가므로,
 * 미완성 펜스를 문단으로 되돌리면 글자가 코드↔본문 사이를 왕복하며 깜빡인다.
 */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let items: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'paragraph', inline: parseInline(para.join('\n')) });
      para = [];
    }
  };
  const flushList = () => {
    if (items.length) {
      blocks.push({ kind: 'list', items: items.map(parseInline) });
      items = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const lang = fence[1] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      blocks.push({ kind: 'codeBlock', lang, text: body.join('\n') });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      items.push(bullet[1] ?? '');
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
