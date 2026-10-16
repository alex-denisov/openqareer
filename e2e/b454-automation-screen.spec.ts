import { expect, test, type Locator, type Page } from '@playwright/test';
import { openAutomationMobile } from './helpers/open-automation-mobile';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import {
  mockSignedInCabinet,
  type AutomationQueueFixtureItem,
} from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = e2eEvidenceDirectory('AUD-6');

const queueItem: AutomationQueueFixtureItem = {
  id: 'automation-queue-item',
  status: 'pending_approval',
  sendTiming: 'today',
  createdAt: '2026-10-09T08:00:00.000Z',
  updatedAt: '2026-10-09T08:00:00.000Z',
  payload: {
    clusterId: 'cluster-1',
    applicationId: null,
    platform: 'hh',
    title: 'Руководитель продукта',
    role: 'Руководитель продукта',
    company: 'FinCloud',
    targetUrl: 'https://hh.ru/vacancy/automation-fixture',
    requirements: { matched: 4, total: 5 },
    letterText: 'Отклик из синтетической фикстуры.',
    materials: [
      { documentId: 'resume-fixture', kind: 'resume', fileName: 'Resume.pdf', version: 1 },
    ],
  },
};

/** The desktop screen shows the queue on the same page; only 390 has the button. */
async function openQueueIfNeeded(page: Page) {
  const openQueue = page.getByRole('button', { name: 'Открыть очередь', exact: true });
  if (await openQueue.isVisible()) await openQueue.click();
}

async function openAutomation(page: Page) {
  await seedWorkspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await openAutomationMobile(page);
    await expect(page.locator('.career-mobile-page-title')).toHaveText('Автоматизация');
    await expect(
      page
        .getByRole('group', { name: 'Раздел откликов' })
        .getByRole('button', { name: 'Автоматизация', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Автоматизация', exact: true })
      .click();
    await expect(page.locator('.career-desktop-topbar h1')).toHaveText('Автоматизация');
    await expect(page.getByRole('tablist', { name: 'Автоматизация' })).toBeVisible();
  }
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

async function captureAutomationState(
  page: Page,
  projectName: string,
  state: string,
  target?: Locator,
) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  if (target) {
    await target.waitFor({ state: 'visible' });
    if (!process.env.ACCEPT_FULL) {
      await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    }
  }
  const viewport = page.viewportSize();
  const fullHeight = process.env.ACCEPT_FULL && viewport;
  if (fullHeight) {
    const scrollHeight = await page
      .locator('.career-main')
      .evaluate((element) => element.scrollHeight);
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, scrollHeight),
    });
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, `${state}-${projectName}.png`),
    fullPage: false,
  });
  if (fullHeight && viewport) await page.setViewportSize(viewport);
}

async function captureAutomationHarness(page: Page, projectName: string) {
  const html = await page.evaluate(() => {
    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const root = document.querySelector('#root')?.innerHTML ?? '';
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${root}</body></html>`;
  });
  await writeFile(join(EVIDENCE_DIR, `automation-screen-${projectName}.html`), html, 'utf8');
}

async function enableAutomationAndOpenQueue(
  page: Page,
  options: Parameters<typeof mockSignedInCabinet>[1] = {},
) {
  await mockSignedInCabinet(page, options);
  await openAutomation(page);
  await page.getByRole('button', { name: 'Включить автоотклики', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Согласия на автоотклики' });
  await dialog.getByLabel('Готовить черновики откликов и писем').check();
  await dialog.getByLabel('Отправлять отклики после моего отдельного одобрения').check();
  await dialog.getByLabel('Показывать очередь и журнал в уведомлениях').check();
  await dialog.getByRole('button', { name: 'Включить режим', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Автоотклики включены', exact: true }),
  ).toBeVisible();
  await openQueueIfNeeded(page);
  await expect(
    page.getByRole('heading', { name: 'Очередь на одобрение', exact: true }),
  ).toBeVisible();
}

function queueFixtureSet(count: number): AutomationQueueFixtureItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...queueItem,
    id: `automation-queue-item-${index + 1}`,
    payload: {
      ...queueItem.payload,
      clusterId: `cluster-${index + 1}`,
      company: index === 0 ? 'FinCloud' : `Компания ${index + 1}`,
    },
  }));
}

test('согласия → очередь → одобрение → журнал без ложного статуса доставки', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page, { candidateId: 'candidate-b232', automationQueue: [queueItem] });
  await openAutomation(page);
  await expect(
    page.getByRole('heading', { name: 'Автоотклики выключены', exact: true }),
  ).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'disabled');
  await captureAutomationHarness(page, testInfo.project.name);

  await page.getByRole('button', { name: 'Включить автоотклики', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Согласия на автоотклики' });
  await expect(dialog).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'consent');
  await dialog.getByLabel('Готовить черновики откликов и писем').check();
  await dialog.getByLabel('Отправлять отклики после моего отдельного одобрения').check();
  await dialog.getByLabel('Показывать очередь и журнал в уведомлениях').check();
  await dialog.getByRole('button', { name: 'Включить режим', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'Автоотклики включены', exact: true }),
  ).toBeVisible();
  await openQueueIfNeeded(page);
  const row = page
    .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
    .filter({ hasText: 'FinCloud' });
  await expect(row).toBeVisible();
  const queueChips = page.getByRole('group', { name: 'Сводка очереди' }).filter({ visible: true });
  await expect(queueChips.getByRole('button', { name: /все/u })).toBeVisible();
  await expect(queueChips.getByRole('button', { name: /уйдёт сегодня/u })).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'queue-pending', row);
  await row.getByRole('button', { name: 'Одобрить и отправить', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Одобрено · ожидает отправки по расписанию.' }),
  ).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'queue-approved',
    page.getByRole('status').filter({ hasText: 'Одобрено · ожидает отправки по расписанию.' }),
  );

  await page.getByRole('tab', { name: 'Журнал', exact: true }).click();
  await expect(
    page.getByText('Попыток отправки за 30 дней пока нет.', { exact: true }),
  ).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'journal-empty',
    page.getByText('Попыток отправки за 30 дней пока нет.', { exact: true }),
  );
  await expect(page.getByRole('list', { name: 'Результаты отправки' })).toHaveCount(0);
});

test('первый вход показывает состояние загрузки на 1440 и 390', async ({ page }, testInfo) => {
  await mockSignedInCabinet(page, { automationSnapshotDelayMs: 1200 });
  await openAutomation(page);
  await expect(page.getByText('Загружаем настройки и очередь…', { exact: true })).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'loading',
    page.getByText('Загружаем настройки и очередь…', { exact: true }),
  );
  await expect(
    page.getByRole('heading', { name: 'Автоотклики выключены', exact: true }),
  ).toBeVisible();
});

test('пустая очередь доступна после включения и имеет собственное состояние', async ({
  page,
}, testInfo) => {
  await enableAutomationAndOpenQueue(page);
  await expect(page.getByText('Записей по этим фильтрам пока нет.', { exact: true })).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'empty',
    page.getByText('Записей по этим фильтрам пока нет.', { exact: true }),
  );
});

test('ошибка загрузки очереди предлагает повторить запрос', async ({ page }, testInfo) => {
  await enableAutomationAndOpenQueue(page, { automationQueueBehavior: { errorStatus: 503 } });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Не удалось загрузить очередь.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'error',
    page.getByRole('alert').filter({ hasText: 'Не удалось загрузить очередь.' }),
  );
});

test('частичная очередь показывает продолжение', async ({ page }, testInfo) => {
  await enableAutomationAndOpenQueue(page, {
    candidateId: 'candidate-b232',
    automationQueue: queueFixtureSet(1),
    automationQueueBehavior: { totalOverride: 3 },
  });
  await expect(
    page.locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible'),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Показать ещё', exact: true })).toBeVisible();
  await captureAutomationState(
    page,
    testInfo.project.name,
    'partial',
    page.getByRole('button', { name: 'Показать ещё', exact: true }),
  );
});

test('большая очередь сохраняет все доступные записи', async ({ page }, testInfo) => {
  await enableAutomationAndOpenQueue(page, {
    candidateId: 'candidate-b232',
    automationQueue: queueFixtureSet(20),
  });
  await expect(
    page.locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible'),
  ).toHaveCount(20);
  await captureAutomationState(
    page,
    testInfo.project.name,
    'many',
    page
      .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
      .first(),
  );
});

const runtimeStates = [
  [
    'send-error',
    { status: 'error' },
    'Последняя отправка завершилась ошибкой. Подробности — в журнале.',
  ],
  [
    'linkedin-not-connected',
    { status: 'linkedin_not_connected' },
    'LinkedIn не подключён. Отправка через эту площадку не начнётся.',
  ],
  [
    'daily-limit',
    { status: 'daily_limit_reached' },
    'Дневной лимит достигнут. Новые отправки начнутся в следующем разрешённом окне.',
  ],
] as const;

for (const [stateName, runtime, message] of runtimeStates) {
  test(`${stateName}: показывает состояние исполнителя`, async ({ page }, testInfo) => {
    await mockSignedInCabinet(page, {
      candidateId: 'candidate-b232',
      automation: {
        settings: { enabled: true, mode: 'approval_required' },
        runtime,
      },
    });
    await openAutomation(page);
    const state = page.getByText(message, { exact: true });
    await expect(state).toBeVisible();
    await captureAutomationState(page, testInfo.project.name, stateName, state);
  });
}

test('пауза на семь дней и её снятие обновляют состояние', async ({ page }, testInfo) => {
  await mockSignedInCabinet(page, {
    candidateId: 'candidate-b232',
    automation: {
      settings: {
        enabled: true,
        mode: 'approval_required',
        pausedUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
      runtime: { status: 'paused', emergencyPaused: true },
    },
  });
  await openAutomation(page);
  const resume = page.getByRole('button', { name: 'Снять паузу', exact: true });
  await expect(resume).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'paused', resume);
  await resume.click();
  await expect(page.getByRole('status').filter({ hasText: 'Пауза снята.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пауза на 7 дней', exact: true })).toBeVisible();
});

test('настройки, правила, согласия, посты и экспорт используют API', async ({ page }, testInfo) => {
  await mockSignedInCabinet(page, {
    candidateId: 'candidate-b232',
    automation: { settings: { enabled: true, mode: 'approval_required' } },
  });
  await openAutomation(page);

  const settingsShortcut = page.getByRole('button', { name: /Настройка режима/u });
  if (await settingsShortcut.isVisible()) await settingsShortcut.click();
  const settings = page.locator('[data-page="settings"]');
  await expect(settings).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'settings', settings);
  await settings.locator('input[type="number"]').first().fill('14');
  await settings.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Настройки расписания сохранены.' }),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page
      .locator('.automation-back-row')
      .getByRole('button', { name: 'Автоматизация', exact: true })
      .click();
  }
  const rulesShortcut = page.getByRole('button', { name: /Правила отбора/u });
  if (await rulesShortcut.isVisible()) await rulesShortcut.click();
  const rules = page.locator('[data-page="rules"]');
  await expect(rules).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'rules', rules);
  await rules.getByRole('button', { name: 'Изменить' }).first().click();
  await rules.locator('#automation-target-roles').fill('Руководитель продукта');
  await rules.getByRole('button', { name: 'Сохранить правила', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Правила отбора сохранены.' }),
  ).toBeVisible();
  await rules.getByRole('button', { name: 'Добавить', exact: true }).click();
  await rules.getByLabel('Компания').fill('FinCloud');
  await rules.getByRole('button', { name: 'Добавить в список', exact: true }).click();
  await rules.getByRole('button', { name: 'Управлять', exact: true }).click();
  await expect(rules.locator('.automation-stop-list')).toContainText('FinCloud');
  await rules.getByRole('button', { name: 'Убрать FinCloud из стоп-компаний' }).click();
  await expect(rules.getByText('Стоп-компаний пока нет.', { exact: true })).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page
      .locator('.automation-back-row')
      .getByRole('button', { name: 'Автоматизация', exact: true })
      .click();
  }
  await page
    .getByRole('button', { name: /Согласия/u })
    .filter({ visible: true })
    .first()
    .click();
  const consentManager = page.getByRole('dialog', { name: 'Согласия и режим' });
  await expect(consentManager).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'consent-manager', consentManager);
  await consentManager.getByRole('button', { name: 'Отозвать', exact: true }).first().click();
  await expect(consentManager.getByText(/Отозвано/u).first()).toBeVisible();
  await consentManager.getByRole('button', { name: 'Готово', exact: true }).click();

  await page.getByRole('tab', { name: 'Посты LinkedIn', exact: true }).click();
  const posts = page.getByRole('region', { name: 'Черновики для LinkedIn' });
  await expect(posts).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'posts', posts);

  await page.getByRole('tab', { name: 'Журнал', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт журнала за 30 дней', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('auto-apply-journal-');
});

test('письмо, стоп-компания и снятие записи выполняются через API', async ({ page }) => {
  await mockSignedInCabinet(page, {
    candidateId: 'candidate-b232',
    automation: { settings: { enabled: true, mode: 'approval_required' } },
    automationQueue: queueFixtureSet(2),
  });
  await openAutomation(page);
  await openQueueIfNeeded(page);

  const first = page
    .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
    .filter({ hasText: 'FinCloud' });
  await first.getByRole('button', { name: 'Править письмо', exact: true }).click();
  const letterDialog = page.getByRole('dialog', { name: /Письмо · FinCloud/u });
  await expect(letterDialog).toBeVisible();
  await letterDialog.locator('#automation-letter-text').fill('Письмо после проверки кандидатом.');
  await letterDialog.getByRole('button', { name: 'Сохранить письмо', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Письмо сохранено в очереди.' }),
  ).toBeVisible();

  await page
    .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
    .filter({ hasText: 'FinCloud' })
    .getByRole('button', { name: 'В стоп-компании', exact: true })
    .click();
  await expect(
    page
      .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
      .filter({ hasText: 'FinCloud' }),
  ).toHaveCount(0);
  const second = page
    .locator('.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible')
    .filter({ hasText: 'Компания 2' });
  await second.getByRole('button', { name: 'Снять с очереди', exact: true }).click();
  await expect(page.getByText('Записей по этим фильтрам пока нет.', { exact: true })).toBeVisible();
});

test('массовое снятие изменяет только видимые выбранные записи', async ({ page }) => {
  await mockSignedInCabinet(page, {
    candidateId: 'candidate-b232',
    automation: { settings: { enabled: true, mode: 'approval_required' } },
    automationQueue: queueFixtureSet(2),
  });
  await openAutomation(page);
  await openQueueIfNeeded(page);
  await page.getByRole('checkbox', { name: /Выбрать показанные/u }).check();
  await page.getByRole('button', { name: 'Снять', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Обновлено записей: 2.' })).toBeVisible();
  await expect(page.getByText('Записей по этим фильтрам пока нет.', { exact: true })).toBeVisible();
});

test('сводка, фильтры и сортировка очереди меняют видимые записи', async ({ page }, testInfo) => {
  const statuses: AutomationQueueFixtureItem['status'][] = [
    'pending_approval',
    'letter_not_ready',
    'approved',
    'failed',
    'pending_approval',
  ];
  const platforms = ['hh', 'linkedin', 'hh', 'linkedin', 'hh'];
  const matches = [4, 3, 5, 2, 4];
  const items = queueFixtureSet(5).map((item, index) => ({
    ...item,
    status: statuses[index],
    sendTiming: index === 0 || index === 3 ? 'today' : 'later',
    updatedAt: `2026-10-09T${String(index + 8).padStart(2, '0')}:00:00.000Z`,
    payload: {
      ...item.payload,
      platform: platforms[index],
      requirements: { matched: matches[index], total: 5 },
    },
  }));
  await mockSignedInCabinet(page, {
    candidateId: 'candidate-b232',
    automation: { settings: { enabled: true, mode: 'approval_required' } },
    automationQueue: items,
  });
  await openAutomation(page);
  await openQueueIfNeeded(page);

  const queue = page.locator('[data-page="queue"]');
  const rows = page.locator(
    '.automation-queue-list > li:visible, .automation-queue-table tbody tr:visible',
  );
  const summary = page.getByRole('group', { name: 'Сводка очереди' });
  await expect(rows).toHaveCount(2);
  await queue.getByLabel('Состояние').selectOption('');
  await expect(rows).toHaveCount(5);
  await summary.getByRole('button', { name: /уйдёт сегодня/u }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('FinCloud');
  await summary.getByRole('button', { name: /позже/u }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Компания 5');
  await summary.getByRole('button', { name: /все/u }).click();

  await queue.getByLabel('Состояние').selectOption('failed');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Компания 4');
  await queue.getByLabel('Состояние').selectOption('');
  await queue.getByLabel('Площадка').selectOption('linkedin');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Компания 2');
  await expect(rows.nth(1)).toContainText('Компания 4');
  await queue.getByLabel('Площадка').selectOption('');
  await queue.getByLabel('Совпадение').selectOption('80');
  await expect(rows).toHaveCount(3);
  await queue.getByLabel('Сортировка').selectOption('match');
  await expect(rows.first()).toContainText('Компания 3');
  await captureAutomationState(page, testInfo.project.name, 'queue-filters', queue);
});

test('фильтры журнала запрашивают выбранные данные, поиск фильтрует локально', async ({ page }) => {
  const entries = [
    {
      id: 'journal-fincloud',
      queueItemId: 'automation-queue-item-1',
      platform: 'hh',
      result: 'delivered',
      receiptStatus: null,
      attempted: true,
      localDate: '2026-10-13',
      company: 'FinCloud',
      occurredAt: '2026-10-13T10:00:00.000Z',
      receiptId: 'receipt-fincloud',
      failureCode: null,
    },
    {
      id: 'journal-cloud',
      queueItemId: 'automation-queue-item-2',
      platform: 'linkedin',
      result: 'error',
      receiptStatus: null,
      attempted: true,
      localDate: '2026-10-12',
      company: 'Cloud',
      occurredAt: '2026-10-12T10:00:00.000Z',
      receiptId: null,
      failureCode: 'platform_rejected',
    },
  ];
  const requests: URL[] = [];
  await mockSignedInCabinet(page, { candidateId: 'candidate-b232' });
  await page.route('**/api/v1/candidate/automation/journal**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const result = url.searchParams.get('result');
    const platform = url.searchParams.get('platform');
    const filtered = entries.filter(
      (entry) => (!result || entry.result === result) && (!platform || entry.platform === platform),
    );
    await route.fulfill({
      json: {
        data: {
          entries: filtered,
          periodDays: Number(url.searchParams.get('periodDays') ?? 30),
          counts: {
            total: filtered.length,
            delivered: filtered.filter((entry) => entry.result === 'delivered').length,
            errors: filtered.filter((entry) => entry.result === 'error').length,
            removed: filtered.filter((entry) => entry.result === 'removed').length,
          },
          limit: 100,
          offset: Number(url.searchParams.get('offset') ?? 0),
        },
      },
    });
  });
  await openAutomation(page);
  await page.getByRole('tab', { name: 'Журнал', exact: true }).click();
  const journal = page.locator('[data-page="journal"]');
  const rows = journal.getByRole('list', { name: 'Результаты отправки' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);

  await journal.getByLabel(/^Период/u).selectOption('7');
  await expect.poll(() => requests.at(-1)?.searchParams.get('periodDays')).toBe('7');
  await journal.getByLabel(/^РезультатВсе/u).selectOption('delivered');
  await expect.poll(() => requests.at(-1)?.searchParams.get('result')).toBe('delivered');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('FinCloud');
  await journal.getByLabel(/^РезультатВсе/u).selectOption('');
  await journal.getByLabel(/^ПлощадкаВсе/u).selectOption('linkedin');
  await expect.poll(() => requests.at(-1)?.searchParams.get('platform')).toBe('linkedin');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Cloud');

  await journal.getByLabel(/^ПлощадкаВсе/u).selectOption('');
  await journal.getByLabel('Компания или квитанция', { exact: true }).fill('FinCloud');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('FinCloud');
});
