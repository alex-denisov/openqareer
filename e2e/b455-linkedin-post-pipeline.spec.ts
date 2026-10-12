import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = join(process.cwd(), 'test-results', 'B455');
const cadence = {
  timezone: 'Europe/Moscow',
  lastPublishedAt: null,
  nextAllowedAt: null,
  canPublish: true,
};

function topic(index: number) {
  return {
    id: index.toString(16).padStart(64, '0'),
    title: `Тема ${index}: результат команды`,
    source: 'Подтверждённый факт профиля',
    sourceRef: `fact-${index}`,
  };
}

function draft(index: number, status: string = 'draft') {
  return {
    id: `draft-${index}`,
    candidateId: 'candidate-b232',
    kind: 'post',
    topic: `Тема черновика ${index}`,
    text: `Текст черновика ${index}.`,
    status,
    localDate: '2026-10-10',
    createdAt: `2026-10-${String(10 - index).padStart(2, '0')}T10:00:00.000Z`,
    updatedAt: `2026-10-${String(10 - index).padStart(2, '0')}T10:00:00.000Z`,
  };
}

async function seedWorkspace(page: Page) {
  await page.addInitScript(
    ({ candidateId, workspace }) => {
      window.localStorage.setItem('candidate-workspace', JSON.stringify(workspace));
      window.localStorage.setItem('candidate-workspace-owner', candidateId);
    },
    {
      candidateId: 'candidate-b232',
      workspace: {
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        resumeText:
          'Руководитель продукта с подтверждёнными результатами в финтехе. Запускала платежные сервисы и улучшала конверсию.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        regions: ['ru'],
        currentSituation:
          'Ищу следующую роль в продуктовой команде с ответственностью за рост и финтех.',
        constraints: '',
        urgency: 'active',
        outcomes: [],
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: [
            {
              id: 'evidence-1',
              kind: 'result',
              sourceExcerpt: 'Рост выручки',
              statement: 'Рост выручки',
              status: 'confirmed',
              userEdited: false,
            },
            {
              id: 'evidence-2',
              kind: 'scope',
              sourceExcerpt: 'Команда из 14 человек',
              statement: 'Команда из 14 человек',
              status: 'confirmed',
              userEdited: false,
            },
            {
              id: 'evidence-3',
              kind: 'scope',
              sourceExcerpt: 'Платёжный продукт',
              statement: 'Платёжный продукт',
              status: 'confirmed',
              userEdited: false,
            },
          ],
          questions: [],
          roleHypotheses: [
            {
              id: 'auto-role',
              title: 'Руководитель продукта',
              fitState: 'plausible',
              basis: 'Опыт продукта',
              evidenceIds: ['evidence-1', 'evidence-2', 'evidence-3'],
              gaps: [],
            },
          ],
        },
      },
    },
  );
}

async function openAutomationPosts(page: Page) {
  await mockSignedInCabinet(page, { candidateId: 'candidate-b232' });
  await seedWorkspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await enterAutomationFromResponses(page);
  await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Черновики для LinkedIn' })).toBeVisible();
}

async function enterAutomationFromResponses(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Отклики', exact: true }).click();
  const responsesNavigation = page.getByRole('navigation', { name: 'Разделы откликов' });
  await responsesNavigation.getByRole('button', { name: 'Автоматизация', exact: true }).click();
}

function fulfillError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({ status, json: { error: { code, message } } });
}

async function installStateApi(page: Page, state: 'empty' | 'error' | 'partial' | 'many') {
  const topics =
    state === 'many'
      ? Array.from({ length: 6 }, (_, index) => topic(index + 1))
      : state === 'empty'
        ? []
        : [topic(1)];
  const drafts =
    state === 'many'
      ? Array.from({ length: 6 }, (_, index) => draft(index + 1))
      : state === 'empty'
        ? []
        : [draft(1)];
  await page.route('**/api/v1/candidate/drafts**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (
      state === 'error' ||
      (state === 'partial' && path.endsWith('/candidate/drafts') && method === 'GET')
    )
      return fulfillError(route, 503, 'draft_writer_unavailable', 'Черновики временно недоступны.');
    if (path.endsWith('/candidate/drafts/topics') && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 3);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return route.fulfill({
        json: {
          data: { items: topics.slice(offset, offset + limit), total: topics.length, cadence },
        },
      });
    }
    if (path.endsWith('/candidate/drafts')) {
      if (method === 'GET')
        return route.fulfill({
          json: { data: drafts.slice(0, Number(url.searchParams.get('limit') ?? 20)) },
        });
      return route.fulfill({
        json: { data: { ...draft(99), topic: 'Созданный кандидатский черновик' } },
      });
    }
    return route.fulfill({ json: { data: { id: 'ok' } } });
  });
}

async function capture(
  page: Page,
  testInfo: { project: { name: string } },
  state: string,
  target?: Locator,
  captureHarness = false,
) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  if (target) {
    await target.waitFor({ state: 'visible' });
    await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, `${state}-${testInfo.project.name}.png`),
    fullPage: false,
  });
  if (captureHarness) await writeHarness(page, testInfo.project.name);
}

async function writeHarness(page: Page, project: string) {
  const html = await page.evaluate(() => {
    const styles = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const css = styles.replace(/oklch\([^)]*\)/gu, (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${r},${g},${b},${alpha / 255})`;
    });
    const root = document.querySelector('#root')?.innerHTML ?? '';
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${root}</body></html>`;
  });
  await writeFile(join(EVIDENCE_DIR, `linkedin-posts-${project}.html`), html, 'utf8');
}

for (const state of ['empty', 'error', 'partial', 'many'] as const) {
  test(`${state}: состояние конвейера LinkedIn видно на 1440 и 390`, async ({ page }, testInfo) => {
    await openAutomationPosts(page);
    await installStateApi(page, state);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterAutomationFromResponses(page);
    await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
    const card = page.getByRole('region', { name: 'Черновики для LinkedIn' });
    await expect(card).toBeVisible();
    if (state === 'empty')
      await expect(
        card.getByText('Черновиков пока нет. Выберите тему или предложите свою.', { exact: true }),
      ).toBeVisible();
    if (state === 'error')
      await expect(
        card.getByText('Не получилось загрузить последние черновики.', { exact: true }),
      ).toBeVisible();
    if (state === 'partial') {
      await expect(
        card.getByText('Не получилось загрузить последние черновики.', { exact: true }),
      ).toBeVisible();
      await expect(card.getByText('Тема 1: результат команды', { exact: true })).toBeVisible();
    }
    if (state === 'many') {
      await expect(
        card.getByRole('button', { name: 'Показать ещё темы', exact: true }),
      ).toBeVisible();
      await expect(
        card.getByRole('button', { name: 'Показать ещё черновики', exact: true }),
      ).toBeVisible();
      await capture(
        page,
        testInfo,
        state,
        card.getByRole('list', { name: 'Темы от консультанта' }),
        true,
      );
      await card.getByRole('button', { name: 'Показать ещё темы', exact: true }).click();
      await expect(card.getByText('Тема 6: результат команды', { exact: true })).toBeVisible();
      await card.getByRole('button', { name: 'Показать ещё черновики', exact: true }).click();
      await expect(card.getByText('Текст черновика 6.', { exact: true })).toBeVisible();
      return;
    }
    const target =
      state === 'empty'
        ? card.getByText('Черновиков пока нет. Выберите тему или предложите свою.', { exact: true })
        : state === 'error'
          ? card.getByRole('alert').first()
          : card.getByText('Тема 1: результат команды', { exact: true });
    await capture(page, testInfo, state, target);
  });
}

test('loading: очередь и темы имеют собственное состояние на 1440 и 390', async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openAutomationPosts(page);
  await page.route('**/api/v1/candidate/drafts**', async (route) => {
    await pending;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/candidate/drafts/topics'))
      return route.fulfill({ json: { data: { items: [], total: 0, cadence } } });
    return route.fulfill({ json: { data: [] } });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterAutomationFromResponses(page);
  await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
  const card = page.getByRole('region', { name: 'Черновики для LinkedIn' });
  await expect(card.getByText('Загружаем черновики…', { exact: true })).toBeVisible();
  await expect(card.getByText('Загружаем темы…', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'loading', card.getByText('Загружаем темы…', { exact: true }));
  release();
  await expect(
    card.getByText('Черновиков пока нет. Выберите тему или предложите свою.', { exact: true }),
  ).toBeVisible();
});

test('тема → правка → одобрение → ручная публикация кандидатом', async ({ page }, testInfo) => {
  const topics = [topic(1)];
  const drafts: Array<Record<string, unknown>> = [];
  let manualCadence = { ...cadence };
  await mockSignedInCabinet(page, { candidateId: 'candidate-b232', linkedinDraftTopics: topics });
  await seedWorkspace(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    window.open = (url) => {
      window.sessionStorage.setItem('b455-opened-linkedin-url', String(url));
      return null;
    };
  });
  await page.route('**/api/v1/candidate/drafts**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path.endsWith('/candidate/drafts/topics') && method === 'GET')
      return route.fulfill({
        json: { data: { items: topics, total: topics.length, cadence: manualCadence } },
      });
    if (path.endsWith('/candidate/drafts') && method === 'GET')
      return route.fulfill({ json: { data: drafts } });
    if (path.endsWith('/candidate/drafts') && method === 'POST') {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      expect(input.topicId).toBe(topic(1).id);
      const created = {
        ...draft(7),
        topic: String(input.topic),
        text: 'Черновик с фактами кандидата.',
      };
      drafts.unshift(created);
      topics.length = 0;
      return route.fulfill({ json: { data: created } });
    }
    if (method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const index = drafts.findIndex((item) => item.id === id);
      const update = route.request().postDataJSON() as Record<string, unknown>;
      drafts[index] = { ...drafts[index], ...update, updatedAt: new Date().toISOString() };
      if (update.status === 'published') {
        const publishedAt = String(drafts[index].updatedAt);
        const nextAllowedAt = new Date(
          new Date(publishedAt).getTime() + 7 * 86400000,
        ).toISOString();
        manualCadence = {
          timezone: 'Europe/Moscow',
          lastPublishedAt: publishedAt,
          nextAllowedAt,
          canPublish: false,
        };
      }
      return route.fulfill({ json: { data: drafts[index] } });
    }
    return route.fulfill({ json: { data: { id: 'dismissed', decision: 'dismissed' } } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await enterAutomationFromResponses(page);
  await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
  const card = page.getByRole('region', { name: 'Черновики для LinkedIn' });
  await card.getByRole('button', { name: 'Взять в работу', exact: true }).click();
  const row = card
    .getByRole('list', { name: 'Черновики и публикация' })
    .getByRole('listitem')
    .filter({ hasText: topic(1).title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Править', exact: true }).click();
  await row
    .getByRole('textbox', { name: 'Текст черновика' })
    .fill('Исправленный текст перед публикацией.');
  await row.getByRole('button', { name: 'Сохранить правку', exact: true }).click();
  await expect(row).toContainText('Исправленный текст перед публикацией.');
  await row.getByRole('button', { name: 'Одобрить', exact: true }).click();
  await expect(row).toContainText('одобрено вами');
  await capture(page, testInfo, 'approved', row);

  let publishCalls = 0;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/v1/candidate/drafts/') &&
      request.method() === 'PATCH' &&
      request.postDataJSON()?.status === 'published'
    )
      publishCalls += 1;
  });
  await row.getByRole('button', { name: 'Скопировать и открыть LinkedIn', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('b455-opened-linkedin-url')))
    .toBe('https://www.linkedin.com/feed/');
  expect(publishCalls).toBe(0);
  await expect(row).toContainText('одобрено вами');
  await row.getByRole('button', { name: 'Отметить опубликованным', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Подтверждение публикации' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Да, отметить', exact: true }).click();
  await expect(row).toContainText('опубликовано по вашему подтверждению');
  expect(publishCalls).toBe(1);
  await expect(card).toContainText('Следующая публикация доступна');
  await capture(page, testInfo, 'published', row);
});
