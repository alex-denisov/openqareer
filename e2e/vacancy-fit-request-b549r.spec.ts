import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { VacancyFitView } from '../shared/vacancyFit';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from './fixtures/readabilityWorkspace';
import { readyVacancyFit } from './fixtures/vacancyFit';

const SHOTS = 'output/playwright/B549-r';

// G5 item 9: checked in WebKit, the engine of the .app.
test.use({ browserName: 'webkit' });

function requirement(id: string, label: string, kind: string, skill: boolean) {
  return {
    id,
    text: label,
    sourceQuote: label,
    origin: 'explicit',
    importance: 'high',
    kind,
    skill,
    label,
    hard: true,
    stopFactor: false,
  };
}

async function openFirst(page: Page, fit: VacancyFitView, onPost: () => void): Promise<void> {
  await mockSignedInCabinet(page, { vacancyTotal: 1 });
  const base = matchedVacancyPage(0, 1);
  await page.route('**/api/v1/candidate/matched-vacancies*', (route) =>
    route.fulfill({
      json: {
        ...base,
        data: base.data.map((item) => ({
          ...item,
          explanation: { ...item.explanation, fitView: fit },
        })),
      },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/fit', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { data: fit } });
    onPost();
    return route.fulfill({
      status: 202,
      json: { data: { ...fit, state: 'processing' } },
    });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click({ timeout: 15_000 });
  const trigger = page.locator('.vacancies-screen-row-trigger').first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

test('B549-r 1440: an uncounted vacancy shows «считаем», the server queues it (28.10 mockup)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'the 1440 row is checked here');
  let posts = 0;
  const base = readyVacancyFit('cluster-0');
  const fit = {
    ...base,
    state: 'not_requested',
    result: undefined,
    requirements: [
      requirement('k', 'Kafka', 'other', true),
      requirement('e', 'Высшее образование', 'education', false),
    ],
  } as unknown as VacancyFitView;
  await openFirst(page, fit, () => (posts += 1));
  const detail = page.locator('.vac-detail').first();
  const conditions = detail.locator('.vacancies-screen-requirements-conditions');
  await expect(conditions).toHaveText('Условия: Высшее образование');
  await expect(
    detail.locator('.vacancies-screen-skill-chip', { hasText: 'Высшее образование' }),
  ).toHaveCount(0);

  await expect(detail.getByRole('region', { name: 'Совпадение считается' })).toContainText(
    'считаем',
  );
  await expect(detail.getByRole('button', { name: 'Рассчитать соответствие' })).toHaveCount(0);
  // B580: the opened card queues its own percent — on Free the sweep stops at 300 rows.
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.vacancies-screen-row-trigger').first()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/1440-webkit-fit-queued.png` });
});
