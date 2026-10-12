import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import {
  mockSignedInCabinet,
  type AutomationQueueFixtureItem,
} from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = e2eEvidenceDirectory('B454');

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

async function openAutomation(page: Page) {
  await seedWorkspace(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Отклики', exact: true }).click();
  const responsesNavigation = page.getByRole('navigation', { name: 'Разделы откликов' });
  await responsesNavigation.getByRole('button', { name: 'Автоматизация', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await expect(page.locator('.career-automation-topbar-title')).toHaveText('Автоматизация');
  } else {
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
    await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, `${state}-${projectName}.png`),
    fullPage: false,
  });
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
  await page.getByRole('button', { name: 'Открыть очередь', exact: true }).click();
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
  await page.getByRole('button', { name: 'Открыть очередь', exact: true }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'FinCloud' });
  await expect(row).toBeVisible();
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
  await expect(page.locator('.automation-queue-list > li')).toHaveCount(1);
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
  await expect(page.locator('.automation-queue-list > li')).toHaveCount(20);
  await captureAutomationState(
    page,
    testInfo.project.name,
    'many',
    page.locator('.automation-queue-list > li').first(),
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

  await page.getByRole('button', { name: /Настройка режима/u }).click();
  const settings = page.locator('[data-page="settings"]');
  await expect(settings).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'settings', settings);
  await settings.locator('input[type="number"]').first().fill('14');
  await settings.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Настройки расписания сохранены.' }),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', { name: 'Автоматизация', exact: true }).click();
  }
  await page.getByRole('button', { name: /Правила отбора/u }).click();
  const rules = page.locator('[data-page="rules"]');
  await expect(rules).toBeVisible();
  await captureAutomationState(page, testInfo.project.name, 'rules', rules);
  await rules.locator('#automation-target-roles').fill('Руководитель продукта');
  await rules.getByRole('button', { name: 'Сохранить правила', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Правила отбора сохранены.' }),
  ).toBeVisible();
  await rules.getByLabel('Компания').fill('FinCloud');
  await rules.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(rules.locator('.automation-stop-list')).toContainText('FinCloud');
  await rules.getByRole('button', { name: 'Убрать FinCloud из стоп-компаний' }).click();
  await expect(rules.getByText('Стоп-компаний пока нет.', { exact: true })).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', { name: 'Автоматизация', exact: true }).click();
  }
  await page.getByRole('button', { name: /Согласия/u }).click();
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
  await page.getByRole('button', { name: 'Открыть очередь', exact: true }).click();

  const first = page.locator('.automation-queue-list > li').filter({ hasText: 'FinCloud' });
  await first.getByRole('button', { name: 'Править письмо', exact: true }).click();
  const letterDialog = page.getByRole('dialog', { name: /Письмо · FinCloud/u });
  await expect(letterDialog).toBeVisible();
  await letterDialog.locator('#automation-letter-text').fill('Письмо после проверки кандидатом.');
  await letterDialog.getByRole('button', { name: 'Сохранить письмо', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Письмо сохранено в очереди.' }),
  ).toBeVisible();

  await page
    .locator('.automation-queue-list > li')
    .filter({ hasText: 'FinCloud' })
    .getByRole('button', { name: 'В стоп-компании', exact: true })
    .click();
  await expect(
    page.locator('.automation-queue-list > li').filter({ hasText: 'FinCloud' }),
  ).toHaveCount(0);
  const second = page.locator('.automation-queue-list > li').filter({ hasText: 'Компания 2' });
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
  await page.getByRole('button', { name: 'Открыть очередь', exact: true }).click();
  await page.getByRole('checkbox', { name: /Выбрать показанные/u }).check();
  await page.getByRole('button', { name: 'Снять', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Обновлено записей: 2.' })).toBeVisible();
  await expect(page.getByText('Записей по этим фильтрам пока нет.', { exact: true })).toBeVisible();
});
