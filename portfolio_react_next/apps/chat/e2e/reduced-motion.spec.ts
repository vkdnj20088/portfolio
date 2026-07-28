import { expect, test, type Page } from '@playwright/test';

/**
 * prefers-reduced-motion 분기 실측.
 *
 * MessageList.scrollToBottom 은 window.matchMedia('(prefers-reduced-motion: reduce)') 로
 * scrollTo 의 behavior 를 'smooth' | 'auto' 로 가른다. jsdom 의 matchMedia 는 항상
 * 거짓을 돌려주는 스텁이라 이 분기를 단위로 검증할 수 없다 - 실제 엔진 + Playwright 의
 * 미디어 에뮬레이션이라야 갈린다. scrollTo 를 가로채 behavior 를 수집해 어느 가지를
 * 탔는지 직접 확인한다.
 */
declare global {
  interface Window {
    __scrollBehaviors: string[];
  }
}

async function interceptScrollBehaviors(page: Page) {
  await page.addInitScript(() => {
    window.__scrollBehaviors = [];
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (
      this: Element,
      options?: ScrollToOptions | number,
      y?: number,
    ) {
      if (typeof options === 'object' && options) {
        window.__scrollBehaviors.push(options.behavior ?? 'auto');
      }
      return original.call(this, options as ScrollToOptions, y as number);
    };
  });
}

/**
 * 홈에서 한 통 보내면 방 생성 -> 이동 -> 진입 즉시 전송으로 새 메시지 append 가 일어나
 * scrollToBottom(smooth 요청)이 호출된다. 응답(대기 말풍선 등장~소멸)까지 기다려
 * 이 사이클의 scrollTo 가 모두 기록된 뒤 반환한다.
 */
async function sendFromHomeAndAwaitReply(page: Page) {
  await page.goto('/');
  const input = page.getByLabel('메시지 입력');
  await input.fill('안녕하세요');
  await input.press('Enter');

  const waiting = page.getByLabel('응답을 생성하는 중');
  await expect(waiting).toBeVisible(); // 대기 진입 -> enter-waiting scrollTo 발생
  await expect(waiting).toBeHidden(); // 응답 도착 -> append scrollTo 발생
}

test.describe('prefers-reduced-motion: reduce', () => {
  test('새 메시지 스크롤이 즉시 이동(auto)한다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await interceptScrollBehaviors(page);
    await sendFromHomeAndAwaitReply(page);

    const { behaviors, reduceMatches } = await page.evaluate(() => ({
      behaviors: window.__scrollBehaviors,
      reduceMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }));

    expect(reduceMatches, 'reduced-motion 이 에뮬레이션되어야 한다').toBe(true);
    expect(behaviors.length).toBeGreaterThan(0);
    // reduce 에서는 모든 프로그램적 스크롤이 즉시(auto)여야 한다. 위반 값을 그대로 드러낸다.
    expect(behaviors.filter((b) => b !== 'auto')).toEqual([]);
  });
});

test.describe('모션 선호 없음(기본)', () => {
  test('새 메시지 스크롤이 부드럽게(smooth) 이동한다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await interceptScrollBehaviors(page);
    await sendFromHomeAndAwaitReply(page);

    const behaviors = await page.evaluate(() => window.__scrollBehaviors);
    expect(behaviors).toContain('smooth');
  });
});
