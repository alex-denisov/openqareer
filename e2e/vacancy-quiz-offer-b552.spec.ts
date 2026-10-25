import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { VacancyFitView } from '../shared/vacancyFit';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const SHOTS = 'output/playwright/B552';
const OFFER = 'Пройти квиз по Kafka и Kubernetes';

const gate = { status: 'matched', reason: 'совпадает' } as const;
const requirement = (id: string, text: string, importance: 'critical' | 'high' | 'medium') => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance,
  kind: 'other',
  hard: false,
  stopFactor: false,
});

/** Payments confirmed by a profile fact; Kafka and Kubernetes not confirmed. */
const fitView = {
  state: 'ready',
  requirements: [
    requirement('r1', 'Платёжные системы', 'critical'),
    requirement('r2', 'Kafka', 'high'),
    requirement('r3', 'Kubernetes', 'medium'),
  ],
  result: {
    candidateId: 'candidate-e2e',
    vacancyId: 'cluster-1',
    algorithmVersion: 'evidence-coverage-3',
    status: 'assessed',
    calculatedAt: '2026-10-20T09:00:00.000Z',
    dataState: 'partial',
    gates: { role: gate, level: gate, region: gate, workAuthorization: gate, workFormat: gate },
    coveragePercent: 33,
    requiredCoverage: { matched: 1, total: 3, percent: 33 },
    coverage: { matched: 1, total: 3, unknown: 0 },
    assessments: [
      { requirementId: 'r1', status: 'matched', evidence: [] },
      { requirementId: 'r2', status: 'unknown', evidence: [] },
      { requirementId: 'r3', status: 'unknown', evidence: [] },
    ],
    reason: 'assessed',
  },
} as unknown as VacancyFitView;

async function openExpandedVacancy(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { firstVacancyFitView: fitView });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  const item = page.locator('.vac-list-item').first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  const trigger = item.locator('.vacancies-screen-row-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

async function openConsultant(page: Page, mobile: boolean) {
  const open = mobile
    ? page.getByRole('button', { name: 'Обсудить с консультантом' })
    : page.getByRole('button', { name: 'Развернуть консультанта' });
  if (mobile || (await open.isVisible())) await open.click();
  return page.getByRole('region', { name: OFFER });
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

for (const project of ['desktop-1440', 'mobile-390'] as const) {
  test(`B552 ${project}: offer opens the skill check; «Не сейчас» survives a reload`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== project, project);
    const mobile = project === 'mobile-390';
    await openExpandedVacancy(page);
    const offer = await openConsultant(page, mobile);
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expect(offer).toContainText('результат попадёт в профиль и в эту вакансию');
    await expect(offer.getByRole('button', { name: 'Начать' })).toBeEnabled();
    await shot(page, `app-${mobile ? '390' : '1440'}-offer`);

    await offer.getByRole('button', { name: 'Начать' }).click();
    const check = page.getByTestId('role-skill-assessment');
    await expect(check).toBeVisible();
    await expect(check).toContainText('подтвердить Kafka и Kubernetes');
    await page.getByLabel('Согласен передать ответы модели для проверки по критериям.').check();
    const started = page.waitForRequest(
      (request) =>
        request.url().endsWith('/role-skill-assessments/start') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Начать проверку' }).click();
    expect((await started).postDataJSON()).toMatchObject({
      focus: { vacancyId: expect.any(String), skills: ['Kafka', 'Kubernetes'] },
    });
    await expect(check).toContainText(
      'Мало данных по Kubernetes: навык есть в 1 из нужных 3 вакансий роли.',
    );
    await expect(page.getByLabel('Ваш ответ')).toBeVisible();
    await shot(page, `app-${mobile ? '390' : '1440'}-check`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openExpandedVacancy(page);
    const again = await openConsultant(page, mobile);
    await expect(again).toBeVisible({ timeout: 15_000 });
    await again.getByRole('button', { name: 'Не сейчас' }).click();
    await expect(again).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openExpandedVacancy(page);
    await openConsultant(page, mobile);
    await expect(page.locator('.vac-detail, .vacancy-push').first()).toBeVisible();
    await expect(page.getByRole('region', { name: OFFER })).toHaveCount(0);
  });
}
