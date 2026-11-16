import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

const FEED = [
  { id: 'u1', role: 'user', content: 'Почему у Ладога Банка 86 %, а у Гринкода только 81?' },
  {
    id: 'a1',
    role: 'assistant',
    content:
      'В Ладога Банке 6 из 7 требований есть в вашем профиле. Не хватает одного: «опыт в платёжных системах от 3 лет».',
  },
  { id: 'u2', role: 'user', content: 'Да, там была платёжная платформа. Команда была 18 человек.' },
  {
    id: 'a2',
    role: 'assistant',
    content: 'Принято. Это нужно записать в профиль, иначе процент для Ладога Банка будет ниже.',
  },
];

const FACT = {
  id: 'fact-1',
  kind: 'fact',
  domain: 'outcome',
  statement: 'Сфера Платежи — команда 18 человек',
  confidence: 'candidate-reported',
  sourceMessageIds: ['u2'],
  sensitive: false,
  status: 'proposed',
};

const TOPICS = [
  'Почему у Ладога Банка 86 %, а у Гринкода только 81',
  'Что проверить в моём профиле перед откликами в банки',
  'Как ответить про уход из Финтех Лаб',
  'Кому напомнить о себе на этой неделе',
];

function conversation(id: string, firstPhrase: string) {
  return {
    id,
    stage: 'vacancies',
    openedAt: '2026-11-10T10:00:00.000Z',
    lastMessageAt: '2026-11-10T10:05:00.000Z',
    closedAt: '2026-11-10T11:00:00.000Z',
    messageCount: 2,
    firstPhrase,
    summary: null,
  };
}

interface ConsultantMocks {
  readonly turn?: 'ok' | 'fail' | 'limit';
  readonly history?: 'two-pages' | 'empty';
  readonly memory?: readonly unknown[];
}

async function openConsultant(page: Page, path: string, mocks: ConsultantMocks = {}) {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const memory = [...(mocks.memory ?? [FACT])];
  const sent: { key: string | undefined; content: string }[] = [];
  const feed = [...FEED];
  await page.route('**/api/v1/candidate/me/messages**', (route) =>
    route.fulfill({ json: { data: feed, meta: { nextOffset: null } } }),
  );
  // Голова снимка: записи из разговора приходят вместе с ней.
  await page.route('**/api/v1/candidate/me?memoryOffset=*', (route) =>
    route.fulfill({
      json: {
        data: {
          candidate: {
            id: 'candidate-1',
            dataClass: 'synthetic',
            locale: 'ru-RU',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
          messages: [],
          memory,
          turns: [],
        },
        meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
      },
    }),
  );
  await page.route('**/api/v1/candidate/billing/quotas', (route) =>
    route.fulfill({
      json: {
        data: {
          plan: 'free',
          unlimited: false,
          period: { startedAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-11-20T09:00:00.000Z' },
          quotas: [
            {
              key: 'coach_turns',
              label: 'Сообщения консультанту',
              limit: 30,
              used: 18,
              remaining: 12,
              upgradePlan: 'basic',
            },
          ],
          fitPercentLimit: null,
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/memory/*', (route) => {
    memory.length = 0;
    return route.fulfill({ status: 200, json: { data: { ok: true } } });
  });
  await page.route('**/api/v1/coach/turn*', (route) => {
    const body = route.request().postDataJSON() as { content: string };
    sent.push({ key: route.request().headers()['idempotency-key'], content: body.content });
    if (mocks.turn === 'limit') {
      return route.fulfill({
        status: 402,
        json: {
          error: {
            code: 'quota_exhausted',
            message: 'Сообщения по тарифу закончились.',
            details: { quota: 'coach_turns', upgradePlan: 'basic' },
          },
        },
      });
    }
    if (mocks.turn === 'fail' && sent.length === 1) {
      return route.fulfill({
        status: 502,
        json: { error: { code: 'provider_failed', message: 'Сбой.', retryable: true } },
      });
    }
    const answer = 'Гринкод просит «собрать команду с нуля». Как было у вас?';
    feed.push(
      { id: `u-${sent.length}`, role: 'user', content: body.content },
      { id: `a-${sent.length}`, role: 'assistant', content: answer },
    );
    return route.fulfill({
      json: {
        data: {
          message: answer,
          phase: 'discovery',
          nextQuestion: null,
          completeness: { known: [], unknown: [] },
          safety: { needsHuman: false, reason: null },
          careerTrack: null,
          actionProposals: [],
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/consultant-history**', (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/consultant-history/')[1];
    if (id) {
      return route.fulfill({
        json: {
          data: {
            ...conversation(id, TOPICS[0]),
            messages: FEED.map((message) => ({
              ...message,
              createdAt: '2026-11-10T10:00:00.000Z',
            })),
          },
        },
      });
    }
    if (mocks.history === 'empty') {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const second = url.searchParams.get('cursor') === 'page-2';
    const data = Array.from({ length: second ? 3 : 20 }, (_, index) => {
      const number = (second ? 20 : 0) + index;
      return conversation(`c${number}`, TOPICS[number % TOPICS.length]);
    });
    return route.fulfill({ json: { data, meta: { nextCursor: second ? null : 'page-2' } } });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.b640 aside.panel-col')).toBeVisible({ timeout: 15_000 });
  return { sent };
}

test.describe('B660: «Консультант» нового кабинета', () => {
  test('разговор: панель в сетке, лента, запись в профиль, гейты', async ({ page }) => {
    await openConsultant(page, '/app/consultant');
    const panel = page.locator('.b640 .app.has-panel > aside.panel-col');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-dialog', '1');
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await expect(panel.locator('.ptop .pend')).toHaveText('1 запись ждёт проверки');
    const card = panel.locator('section.ec.fc');
    await expect(card.locator('.ec-title')).toHaveText(
      'Записать в профиль: Сфера Платежи — команда 18 человек',
    );
    await expectGates(page);
    await card.getByRole('button', { name: 'Верно' }).click();
    await expect(panel.locator('.chat .res-row')).toHaveText('Записано в профиль');
    await expect(panel.locator('.ptop')).toHaveCount(0);
    await expect(panel).not.toContainText(/пока недоступно|gemini|gpt|openrouter|vertex/iu);
  });

  test('вопрос и ответ на месте; ввод закреплён внизу панели', async ({ page }) => {
    const { sent } = await openConsultant(page, '/app/consultant', { memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('А что с Гринкодом?');
    await field.press('Enter');
    await expect(panel.locator('.msg.me').last()).toHaveText('А что с Гринкодом?');
    await expect(panel.locator('.msg.bot').last()).toContainText('Гринкод просит');
    await expect(field).toHaveValue('');
    expect(sent).toHaveLength(1);
    const form = await panel.locator('form.compose').boundingBox();
    const view = page.viewportSize();
    expect(form && view && form.y + form.height).toBeLessThanOrEqual(view?.height ?? 0);
  });

  test('ответ не пришёл: «Повторить» шлёт тот же вопрос тем же ключом', async ({ page }) => {
    const { sent } = await openConsultant(page, '/app/consultant', { turn: 'fail', memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('Как это сформулировать?');
    await field.press('Enter');
    const error = panel.locator('.chat > .res-row.is-err');
    await expect(error).toContainText('Ответ не пришёл');
    await expect(panel.locator('.msg.me').last()).toHaveText('Как это сформулировать?');
    await error.getByRole('button', { name: 'Повторить' }).click();
    await expect(panel.locator('.msg.bot').last()).toContainText('Гринкод просит');
    await expect(error).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test('предел сообщений: ввод закрыт, строка ведёт к тарифам', async ({ page }) => {
    await openConsultant(page, '/app/consultant', { turn: 'limit', memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('Как это сформулировать?');
    await field.press('Enter');
    const line = panel.locator('form.compose.is-off .cmp-line');
    await expect(line).toContainText('Лимит сообщений исчерпан');
    await expect(field).toBeDisabled();
    await expectGates(page);
    await line.getByRole('link', { name: /Перейти на/u }).click();
    await expect(page).toHaveURL(/\/app\/tariffs$/u);
  });

  test('все разговоры: по 20, «Показать ещё», прошлый разговор и путь назад', async ({ page }) => {
    await openConsultant(page, '/app/consultant/history');
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.ph-title')).toHaveText('Все разговоры');
    const rows = panel.locator('ul.hist.hist2 > li');
    await expect(rows).toHaveCount(20);
    await expectGates(page);
    await panel.getByRole('button', { name: 'Показать ещё' }).click();
    await expect(rows).toHaveCount(23);
    await expect(panel.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
    await rows.first().locator('a').click();
    await expect(page).toHaveURL(/\/app\/consultant\?conversation=c0$/u);
    await expect(panel.locator('.chat .day')).toHaveText('10 ноября');
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await panel.getByRole('link', { name: 'Все разговоры' }).click();
    await expect(page).toHaveURL(/\/app\/consultant\/history$/u);
  });

  test('разговоров нет: одна строка и «Начать» открывает разговор', async ({ page }) => {
    await openConsultant(page, '/app/consultant/history', { history: 'empty' });
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.vl-empty-t')).toHaveText('Разговоров пока нет');
    await expectGates(page);
    await panel.getByRole('button', { name: 'Начать' }).click();
    await expect(page).toHaveURL(/\/app\/consultant$/u);
    await expect(panel.getByLabel('Ваш вопрос консультанту')).toBeVisible();
  });

  test('«Свернуть» закрывает панель и возвращает в кабинет', async ({ page }) => {
    await openConsultant(page, '/app/consultant');
    await page.locator('.b640 aside.panel-col').getByRole('button', { name: 'Свернуть' }).click();
    await expect(page).toHaveURL(/\/app\/today$/u);
    await expect(page.locator('.b640 aside.panel-col')).toHaveCount(0);
    await expect(page.locator('.b640 .app.has-panel')).toHaveCount(0);
  });

  test('снимки «Консультанта»: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(180_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      { name: 'k01', path: '/app/consultant', mocks: {} },
      { name: 'k05', path: '/app/consultant/history', mocks: {} },
      { name: 'k05b', path: '/app/consultant/history', mocks: { history: 'empty' } },
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const view of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openConsultant(page, view.path, view.mocks);
          await page.locator('.b640 .chat').locator('> *').first().waitFor();
          await page.screenshot({ path: `.s13-shots/${view.name}-${width}-${theme}.png` });
        }
      }
    }
  });
});
