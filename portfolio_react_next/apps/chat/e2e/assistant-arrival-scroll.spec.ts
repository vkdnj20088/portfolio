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

  // 대기에 "진입"하면 앱은 명세대로 한 번 최하단으로 내려간다. 그 스크롤은 smooth 라 버튼이
  // 보이는 시점에도 아직 날아가는 중일 수 있다. 브라우저는 사용자 입력으로는 진행 중인 smooth
  // 스크롤을 취소하지만 scrollTop 대입으로는 취소하지 않는다 - 대입 직후에도 애니메이션이 남은
  // 거리만큼 값을 계속 밀어서(실측 +13 ~ +42px) 올려둔 위치가 재는 순간마다 달라졌다.
  // 실사용자의 휠에는 없는 테스트만의 인공물이므로, 애니메이션이 멎은 뒤에 올린다.
  await scroller.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        let last = -1;
        let stable = 0;
        let frames = 0;
        const tick = () => {
          if (el.scrollTop === last) stable += 1;
          else {
            stable = 0;
            last = el.scrollTop;
          }
          frames += 1;
          // 60프레임(약 1초)이면 멎지 않아도 진행한다 - 여기서 멈춰 세우는 것이 목적이 아니다.
          if (stable >= 5 || frames > 60) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );

  // 응답이 오기 전(2초 창)에 위로 올린다. scrollTop=120: 최상단 로딩(<=1) 은 피하되 바닥에서 멀다.
  const afterScrollUp = await scroller.evaluate((el) => {
    el.scrollTop = 120;
    return {
      scrollTop: el.scrollTop,
      distFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    };
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
  // 올려둔 위치가 그대로 유지된다(위 히스토리는 불변이라 scrollTop 값이 보존된다).
  // 응답은 뷰포트 아래에 붙으므로 scrollTop 은 원리상 1px 도 움직이지 않는다 - 실측도 0 이다.
  // 여유 2px 는 앱이 최상단 판정에 쓰는 것과 같은 소수점 스크롤 대비분이고, 그 이상 벌어지면
  // 게이트가 뚫린 것이다(이 값을 늘려 통과시키지 말 것).
  expect(Math.abs(afterReply.scrollTop - afterScrollUp.scrollTop)).toBeLessThan(2);
});
