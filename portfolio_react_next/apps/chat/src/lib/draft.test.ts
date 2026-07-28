import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRoomDraft,
  readRoomDraft,
  saveRoomDraft,
  setPendingMessage,
  takePendingMessage,
} from './draft';

/**
 * "첫 메시지 핸드오프" 저장소의 계약을 고정한다.
 *
 * 홈은 방을 만들며 pending 을 남기고, 채팅방이 진입 직후 그것을 소비해 전송한다.
 * 이 소비가 정확히 1회여야 새로고침/재마운트에서 같은 메시지가 중복 전송되지 않는다
 * - 그 불변식을 여기서 실증한다. jsdom 이 제공하는 sessionStorage 위에서 돈다.
 */
beforeEach(() => {
  window.sessionStorage.clear();
});

describe('pending 메시지 1회 소비', () => {
  it('take 는 값을 돌려주고 즉시 지운다(두 번째 take 는 null)', () => {
    setPendingMessage('room-1', '안녕하세요');
    expect(takePendingMessage('room-1')).toBe('안녕하세요');
    expect(takePendingMessage('room-1')).toBeNull();
  });

  it('다른 방의 take 는 pending 을 소비하지 않는다(대상 방이 그대로 받는다)', () => {
    setPendingMessage('room-1', '안녕하세요');
    expect(takePendingMessage('room-2')).toBeNull();
    expect(takePendingMessage('room-1')).toBe('안녕하세요');
  });

  it('저장된 값이 없으면 null', () => {
    expect(takePendingMessage('room-1')).toBeNull();
  });
});

describe('방별 드래프트 write-through', () => {
  it('저장한 초안을 다시 읽고, clear 로 지운다', () => {
    saveRoomDraft('room-1', '작성 중인 초안');
    expect(readRoomDraft('room-1')).toBe('작성 중인 초안');
    clearRoomDraft('room-1');
    expect(readRoomDraft('room-1')).toBe('');
  });

  it('빈 값 저장은 키를 남기지 않는다(빈 문자열로 읽힘)', () => {
    saveRoomDraft('room-1', '초안');
    saveRoomDraft('room-1', '');
    expect(readRoomDraft('room-1')).toBe('');
  });
});
