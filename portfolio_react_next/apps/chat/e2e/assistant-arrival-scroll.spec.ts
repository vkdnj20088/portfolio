import { expect, test } from '@playwright/test';

/**
 * 어시스턴트 응답 "도착" 시 자동스크롤 게이트 실측.
 *
 * 규칙: 사용자 본인 메시지는 최하단으로 내리지만, 위로 올라가 과거를 읽는 중에 응답이 완성돼
 * 목록에 append 될 때는 화면을 최하단으로 뺏지 않는다(스트리밍 추적과 동일한 하단 근처 판정).
 * 이 산술은 실제 레이아웃 높이(scrollHeight/clientHeight)에 의존해 jsdom(항상 0)으로는 검증
 * 불가 - 실제 크로미움에서 스크롤 위치 불변으로 확인한다. 응답 지연은 명세값 2초라 그 사이
 * 위로 올려둘 여유가 있다.
 */
test('위로 올려 읽는 중에 응답이 도착해도 최하단으로 끌려가지 않는다', async ({ page }) => {
  await page.goto('/');

  // 스크롤 가능한 히스토리가 있는 방으로 진입(첫 페이지 50개 = 뷰포트를 넘침).
  await page.getByRole('link', { name: /페이지네이션 데모/ }).click();
  const scroller = page.getByRole('log', { name: '메시지 목록' });
  await expect(scroller).toBeVisible();

  // 메시지를 전송한다 - 본인 메시지는 최하단으로, 이어 대기("중지")로 진입한다.
  await page.getByRole('textbox', { name: '메시지 입력' }).fill('테스트 질문');
  await page.getByRole('button', { name: '전송' }).click();
  await expect(page.getByText('테스트 질문')).toBeAttached();
  await expect(page.getByRole('button', { name: '중지' })).toBeVisible();

  // 응답이 오기 전(2초 창)에 위로 올린다. scrollTop=120: 최상단 로딩(<=1) 은 피하되 바닥에서 멀다.
  const afterScrollUp = await scroller.evaluate((el) => {
    el.scrollTop = 120;
    return { scrollTop: el.scrollTop, distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight };
  });
  // 사전조건: 실제로 바닥에서 충분히 멀어졌다(하단 근처 임계 240px 훨씬 초과).
  expect(afterScrollUp.distFromBottom).toBeGreaterThan(240);

  // 응답 도착 = 대기("중지") 종료. 명세 2초 + 여유.
  await expect(page.getByRole('button', { name: '중지' })).toHaveCount(0, { timeout: 6000 });

  const afterReply = await scroller.evaluate((el) => ({
    scrollTop: el.scrollTop,
    distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
  }));

  // 핵심: 응답이 붙어도 바닥으로 튀지 않았다(여전히 하단 근처가 아님). 게이트가 없으면
  // scrollTop 이 바닥까지 뛰어 distFromBottom 이 0 근처가 된다.
  expect(afterReply.distFromBottom).toBeGreaterThan(240);
  // 올려둔 위치가 사실상 그대로 유지된다(위 히스토리는 불변이라 scrollTop 값이 보존된다).
  expect(Math.abs(afterReply.scrollTop - afterScrollUp.scrollTop)).toBeLessThan(40);
});
