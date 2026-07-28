import { expect, test } from '@playwright/test';

/**
 * 이전 페이지 prepend 시 스크롤 앵커링 실측.
 *
 * 브라우저의 기본 scroll anchoring 은 scrollTop=0 에서 무력하므로, MessageList 는
 * prepend 직후(useLayoutEffect, 페인트 전) 늘어난 높이만큼 scrollTop 을 더해 보던
 * 위치를 고정한다. 이 산술은 실제 레이아웃 높이(scrollHeight)에 의존해 jsdom(항상 0)
 * 으로는 검증 불가 - 실제 크로미움에서 기준 메시지의 뷰포트 위치 불변으로 확인한다.
 *
 * 시드에 130개짜리 방("페이지네이션 데모")이 있어 첫 페이지(최신 50개, 81~130)만
 * 로드된 상태에서 최상단으로 올리면 이전 50개(31~80)가 prepend 된다.
 *
 * 측정 주의: scrollTop=0 설정 직후 스크롤 이벤트가 로딩 스피너를 최상단에 끼워 기준
 * 메시지를 잠시 밀어낸다. 그래서 "이전" 위치는 스크롤 설정과 같은 동기 태스크(이벤트
 * 발화 이전)에서 한 번에 읽어 스피너 트랜지언트에 오염되지 않게 한다.
 */
test('최상단에서 이전 페이지가 붙어도 보던 메시지의 위치가 유지된다', async ({ page }) => {
  await page.goto('/');

  // 사이드바에서 130개 방으로 진입(링크의 접근 이름에 방 제목이 들어 있다).
  await page.getByRole('link', { name: /페이지네이션 데모/ }).click();

  const scroller = page.getByRole('log', { name: '메시지 목록' });
  await expect(scroller).toBeVisible();

  // 첫 페이지의 최상단 메시지(81번째 질문)를 기준으로 삼는다.
  const anchor = page.getByText(/^81번째 질문입니다/);
  await expect(anchor).toBeAttached();

  const scrollerEl = await scroller.elementHandle();
  const anchorEl = await anchor.elementHandle();
  expect(scrollerEl).not.toBeNull();
  expect(anchorEl).not.toBeNull();

  // 최상단으로 올리며 같은 동기 태스크에서 기준 메시지의 뷰포트 상대 위치를 읽는다
  // (스크롤 이벤트/로딩 스피너 커밋이 일어나기 전의 quiescent 값).
  const before = await page.evaluate(
    ([s, a]) => {
      const el = s as HTMLElement;
      el.scrollTop = 0;
      return (a as HTMLElement).getBoundingClientRect().top - el.getBoundingClientRect().top;
    },
    [scrollerEl, anchorEl],
  );

  // 이전 페이지(31~80)가 붙을 때까지 기다린다. 성공 setState 가 items 추가와
  // loadingOlder=false 를 함께 커밋하므로, 31번째가 붙었으면 스피너도 이미 사라졌다.
  await expect(page.getByText(/^31번째 질문입니다/)).toBeAttached();

  const after = await page.evaluate(
    ([s, a]) => {
      const el = s as HTMLElement;
      return (a as HTMLElement).getBoundingClientRect().top - el.getBoundingClientRect().top;
    },
    [scrollerEl, anchorEl],
  );

  // 기준 메시지의 뷰포트 위치가 유지된다(prepend 높이만큼 scrollTop 이 보정됨).
  expect(Math.abs(after - before)).toBeLessThan(4);
  // 최상단으로 튕겨 올라가지 않았다(앵커링이 실제로 개입).
  const scrollTop = await scroller.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
});
