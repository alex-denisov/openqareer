import { expect, test, type Page } from '@playwright/test';
import type { CandidateConnection } from '../src/features/coach/coachApi';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

/**
 * B538 — шесть состояний экрана 0 «Вход и первый запуск» из реальных условий:
 * долгий ответ входа, отказ сервера, 401, пропуск источника, один коннектор,
 * скелет. Тексты — дословно из блока «Состояния» макета.
 */

const linkedinOnly: CandidateConnection[] = [
  {
    platform: 'linkedin',
    available: true,
    capabilities: ['profile_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-10-10T08:00:00.000Z',
    lastImportedAt: '2026-10-12T08:00:00.000Z',
    factCount: 12,
  },
  {
    platform: 'hh',
    available: true,
    capabilities: ['profile_read', 'resume_read'],
    importsCareerHistory: true,
    status: 'disconnected',
  },
];

async function openNewCandidate(
  page: Page,
  accountConnections: readonly CandidateConnection[] = [],
): Promise<void> {
  await mockSignedInCabinet(page, { candidateId: 'candidate-b538', accountConnections });
  await page.route('**/api/v1/candidate/workspace', (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('openqareer_session_token', 'synthetic-b538-session');
  });
}

async function holdSession(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await gate;
    return route.fallback();
  });
  return release;
}

async function reachSourceStep(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  await page.getByTestId('goal-textarea').fill('Хочу роль руководителя разработки.');
  await page.getByTestId('save-goal-btn').click();
  await expect(page.getByTestId('first-run-wizard')).toHaveAttribute('data-step', 'source');
}

test('skeleton: one «Сегодня» heading while the session is read', async ({ page }) => {
  await openNewCandidate(page);
  const release = await holdSession(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.career-session-gate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toHaveCount(1);
  release();
});

test('stale loading: a long sign-in names its subject', async ({ page }) => {
  await openNewCandidate(page);
  const release = await holdSession(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const stale = page.getByTestId('first-run-stale-loading');
  await expect(stale).toHaveText('Проверяем вход…', { timeout: 15_000 });
  await expect(page.getByText('Собираем')).toHaveCount(0);
  release();
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
  await expect(stale).toHaveCount(0);
});

test('error: the server does not answer, one retry recovers', async ({ page }) => {
  await openNewCandidate(page);
  let failOnce = true;
  await page.route('**/api/v1/auth/me', (route) => {
    if (!failOnce) return route.fallback();
    failOnce = false;
    return route.fulfill({ status: 500, json: { error: { code: 'internal' } } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось войти: сервер не ответил. Данные не потеряны.',
  );
  const gate = page.locator('.career-session-gate');
  await expect(gate.getByRole('button')).toHaveCount(1);
  await gate.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByTestId('first-run-wizard')).toBeVisible();
});

test('session expired: a 401 signs the whole app out once', async ({ page }) => {
  await openNewCandidate(page);
  await page.route('**/api/v1/candidate/**', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'unauthorized' } } }),
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  await expect(page.getByRole('status')).toContainText(
    'Вход устарел. Войдите снова, один раз для всего приложения.',
    { timeout: 30_000 },
  );
  await expect(page.getByRole('button', { name: 'Войти в кабинет', exact: true })).toBeVisible();
});

test('empty: a skipped source offers the consultant on step 3', async ({ page }, info) => {
  // По макету «Пропустить этот шаг» есть только на 390 (m-actions); на 1440 шаг
  // «Источник» пропустить нельзя, поэтому и пустого состояния там нет.
  test.skip(info.project.name !== 'mobile-390', 'Skip exists only in the 390 layout');
  await openNewCandidate(page);
  await reachSourceStep(page);
  await page.getByTestId('source-skip-btn').click();
  await page.getByTestId('skip-confirm-btn').click();
  const empty = page.getByTestId('first-run-empty-sources');
  await expect(empty).toContainText(
    'Источник не выбран. Можно рассказать консультанту, профиль соберётся из ответов.',
  );
  await empty.getByRole('button', { name: 'Рассказать консультанту' }).click();
  await expect(page.locator('#career-consultant-sheet')).toHaveAttribute(
    'data-mobile-expanded',
    'true',
  );
});

test('partial: exactly one connector on the server is named', async ({ page }) => {
  await openNewCandidate(page, linkedinOnly);
  await reachSourceStep(page);
  await expect(page.getByTestId('first-run-partial-sources')).toHaveText(
    'LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.',
  );
});
