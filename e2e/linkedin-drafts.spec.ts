import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const draft = {
  id: 'draft-b318',
  candidateId: 'candidate-b232',
  kind: 'comment',
  topic: 'Продуктовая команда',
  targetPostUrl: null,
  text: 'В моей команде мы проверяли гипотезы вместе с аналитиками.',
  status: 'draft',
  localDate: '2026-09-30',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

async function openCard(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Черновики для LinkedIn' });
  await expect(card).toBeVisible();
  return card;
}

async function verifyComposition(page: Page, state: string, width: number) {
  if (width === 1440 && state !== 'free') {
    const filled = await page.locator('main').evaluate((main) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--career-accent)';
      main.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return [...main.querySelectorAll('button')]
        .filter((button) => getComputedStyle(button).backgroundColor === accent)
        .map((button) => button.textContent?.trim());
    });
    expect(filled).toEqual(['Проверить факты']);
    const heights = await page.locator('.career-today-panels').evaluate((panels) => ({
      queue: panels.querySelector('.career-today-queue')!.getBoundingClientRect().height,
      side: panels.querySelector('.career-today-side')!.getBoundingClientRect().height,
    }));
    expect(heights.side).toBeLessThanOrEqual(heights.queue + 1);
  }
}

async function capture(page: Page, state: string, width: number) {
  await verifyComposition(page, state, width);
  const target =
    state === 'free'
      ? page.getByRole('dialog')
      : page.getByRole('region', { name: 'Черновики для LinkedIn' });
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/playwright/B318/${state}-${width}.png`, fullPage: true });
  await target.screenshot({ path: `output/playwright/B318/${state}-card-${width}.png` });
  const html = await page.evaluate(() => {
    const sourceCss = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
      .join('\n');
    // Kit читает RGB; Canvas переводит OKLCH в те же экранные цвета без смены палитры.
    const context = document.createElement('canvas').getContext('2d')!;
    const css = sourceCss.replace(/oklch\([^)]*\)/gu, (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${r},${g},${b},${alpha / 255})`;
    });
    const card =
      document.querySelector('[aria-label="Черновики для LinkedIn"]') ??
      document.querySelector('.career-drafts');
    const dialog = document.querySelector('[role="dialog"]');
    const shell = document.querySelector('.career-shell');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div class="${shell?.className ?? 'career-shell'}" style="display:block"><main>${(dialog ?? card)?.outerHTML ?? ''}</main></div></body></html>`;
  });
  await writeFile(`output/playwright/B318/${state}-${width}.html`, html);
}

test('подготовить комментарий, скопировать и сохранить статус', async ({ page }, info) => {
  await mockSignedInCabinet(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let status = 'draft';
  let created = false;
  await page.route('**/api/v1/candidate/drafts**', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'comment', topic: draft.topic });
      created = true;
      return route.fulfill({ json: { data: { ...draft, status } } });
    }
    if (method === 'PATCH') {
      status = route.request().postDataJSON().status;
      return route.fulfill({ json: { data: { ...draft, status } } });
    }
    return route.fulfill({ json: { data: created ? [{ ...draft, status }] : [] } });
  });
  const card = await openCard(page);
  const width = info.project.name === 'desktop-1440' ? 1440 : 390;
  await capture(page, 'empty', width);
  await card.getByLabel('Тема', { exact: true }).fill(draft.topic);
  await card.getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
  await expect(card.getByText(draft.text).first()).toBeVisible();
  await capture(page, 'ready', width);
  await card.getByRole('button', { name: 'Скопировать', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Скопировано', exact: true })).toBeVisible();
  await expect.poll(() => status).toBe('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draft.text);
  await expect(card.getByRole('list', { name: 'Последние черновики' })).toContainText(
    status === 'copied' ? 'скопирован' : 'отклонён',
  );
  await capture(page, 'copied', width);
  await card.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect.poll(() => status).toBe('rejected');
  await expect(card.getByRole('button', { name: 'Отклонить', exact: true })).toHaveCount(0);
  await expect(card.getByRole('list', { name: 'Последние черновики' })).toContainText(
    status === 'copied' ? 'скопирован' : 'отклонён',
  );
});

test('free открывает окно тарифов и выбор Pro ведёт на Тарифы', async ({ page }, info) => {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/drafts**', async (route) =>
    route.fulfill({
      status: route.request().method() === 'POST' ? 402 : 200,
      json:
        route.request().method() === 'POST'
          ? { error: { code: 'paywall_required', message: 'Выберите тариф для черновиков' } }
          : { data: [] },
    }),
  );
  const card = await openCard(page);
  await card.getByLabel('Тема', { exact: true }).fill(draft.topic);
  await card.getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await capture(page, 'free', info.project.name === 'desktop-1440' ? 1440 : 390);
  await dialog.getByRole('button', { name: 'Выбрать Pro', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Тарифы', exact: true }),
  ).toBeVisible();
});

for (const [state, code, message] of [
  ['error', 503, 'Не удалось подготовить черновик. Попробуйте позже'],
  ['limit', 429, 'На сегодня черновиков больше нет: лимит 3 в день'],
] as const) {
  test(`${state}: показывает ответ сервера`, async ({ page }, info) => {
    await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/drafts**', async (route) =>
      route.fulfill({
        status: route.request().method() === 'POST' ? code : 200,
        json:
          route.request().method() === 'POST'
            ? {
                error: {
                  code: state === 'limit' ? 'draft_daily_limit' : 'draft_writer_unavailable',
                  message,
                },
              }
            : { data: [] },
      }),
    );
    const card = await openCard(page);
    await card.getByLabel('Тема', { exact: true }).fill(draft.topic);
    await card.getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
    await expect(card.getByText(message, { exact: true })).toBeVisible();
    await capture(page, state, info.project.name === 'desktop-1440' ? 1440 : 390);
  });
}

test('загрузка блокирует повторную подготовку', async ({ page }, info) => {
  await mockSignedInCabinet(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/candidate/drafts**', async (route) => {
    if (route.request().method() === 'POST') await pending;
    return route.fulfill({ json: { data: route.request().method() === 'POST' ? draft : [] } });
  });
  const card = await openCard(page);
  await card.getByLabel('Тема', { exact: true }).fill(draft.topic);
  await card.getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Готовлю…', exact: true })).toBeDisabled();
  await capture(page, 'loading', info.project.name === 'desktop-1440' ? 1440 : 390);
  release();
  await expect(card.getByText(draft.text).first()).toBeVisible();
});
