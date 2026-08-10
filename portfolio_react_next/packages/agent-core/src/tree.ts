import type { Span } from './types';

/** 화면이 그리는 트리 노드. span 자체는 평평한 배열로 커밋하고 화면에서만 트리로 편다. */
export interface SpanNode {
  span: Span;
  depth: number;
  children: SpanNode[];
  /** 자식들의 durationMs 합을 뺀 값. 모델이 느린지 도구가 느린지 화면에서 갈려야 한다. */
  selfMs: number;
}

/**
 * 평평한 span 배열을 트리로 편다.
 *
 * 부모를 못 찾은 span 은 버리지 않고 루트로 올린다 - 산출물이 손상돼도 화면이 빈 채로 뜨는
 * 것보다 "이상하지만 보이는" 편이 낫다. 손상 자체는 테스트가 따로 잡는다.
 */
export function buildTree(spans: Span[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  for (const span of spans) {
    byId.set(span.spanId, { span, depth: 0, children: [], selfMs: span.durationMs });
  }

  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const assign = (node: SpanNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.span.startOffsetMs - b.span.startOffsetMs);
    let childTotal = 0;
    for (const child of node.children) {
      childTotal += child.span.durationMs;
      assign(child, depth + 1);
    }
    node.selfMs = Math.max(0, node.span.durationMs - childTotal);
  };
  roots.sort((a, b) => a.span.startOffsetMs - b.span.startOffsetMs);
  for (const root of roots) assign(root, 0);
  return roots;
}

/** 트리를 화면 순서(깊이 우선)로 편다. 렌더가 재귀 없이 한 번에 돈다. */
export function flatten(nodes: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = [];
  const walk = (list: SpanNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * 실패한 span 은 접히지 않는다. 성공만 보이면 이 데모의 값이 절반이라, 접힘 여부를
 * 화면 상태가 아니라 span 상태에서 끌어온다.
 */
export function alwaysExpanded(span: Span): boolean {
  return span.status === 'error' || span.status === 'blocked';
}
