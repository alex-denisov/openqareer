import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const SHOTS = 'output/playwright/B549-r';
const ACTIONS = [
  /Путь к компании/u,
  /Хочу в эту компанию/u,
  /Открыть на площадке/u,
  /Обсудить с консультантом/u,
];

// G5 M1: a phone, not a stretched desktop window — WebKit with touch at 390×844.
test.use({
  browserName: 'webkit',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

/** A long vacancy text pushes the actions below the fold, as on the prod vacancy. */
async function lengthenDescriptions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (!url.includes('/candidate/matched-vacancies')) return response;
      const body = await response.clone().json();
      const long = ' Команда строит платформу платежей и отвечает за её надёжность.'.repeat(40);
      for (const item of body?.data?.items ?? body?.data ?? []) {
        if (item?.cluster) item.cluster.descriptionSummary += long;
      }
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: response.headers,
      });
    };
  });
}

async function tapReachable(page: Page, action: Locator): Promise<void> {
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  const box = await action.boundingBox();
  if (!box) throw new Error('action has no box');
  const hit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest('button, a')?.textContent?.trim() ?? null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe((await action.textContent())?.trim() ?? '');
}

test('B549-r 390 WebKit: every push action is reachable by scroll and tap', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'phone push');
  await lengthenDescriptions(page);
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.tap();
  const item = page.locator('.vac-list-item').first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.locator('.vacancies-screen-row-trigger').tap();

  const push = page.locator('.vacancy-push');
  await expect(push.locator('#vacancy-push-title')).toHaveText('Вакансия');
  const list = push.locator('.vacancy-push-list').last();
  expect(await list.evaluate((node) => node.clientHeight)).toBeGreaterThan(0);
  expect(await push.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/390-webkit-job-top.png` });

  for (const name of ACTIONS) {
    await tapReachable(page, push.getByRole('button', { name }).first());
  }
  await page.screenshot({ path: `${SHOTS}/390-webkit-job-actions.png` });

  await push
    .getByRole('button', { name: /Путь к компании/u })
    .first()
    .tap();
  await expect(push.locator('#vacancy-push-title')).toHaveText('Путь к компании');
});
