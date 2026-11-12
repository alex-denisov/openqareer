import { expect, test, type Page } from '@playwright/test';

/**
 * B643-11 — «Покрытие компаний». Итоги и страницы компаний подменяются в
 * браузере, как в admin-console.spec.ts; проверяются оба вьюпорта без
 * горизонтальной прокрутки, переключение способа и «Показать ещё».
 */

const ADMINISTRATOR = {
  username: 'admin.test',
  email: 'admin@example.com',
  displayName: 'Администратор',
  role: 'admin' as const,
  isTest: false,
  candidateId: null,
};

const NOW = Date.now();
const MIN = 60_000;

const TOTALS = {
  totalCompanies: 261_964,
  computedAt: NOW - 7 * MIN,
  classes: {
    site: { companies: 20_918, vacancies: 343_073 },
    ats: { companies: 134_127, vacancies: 384_143 },
    linkedin_only: { companies: 41, vacancies: 1_142 },
    aggregator_only: { companies: 7_490, vacancies: 71_524 },
    none: { companies: 99_388, vacancies: 0 },
  },
};

const site = (id: string, domain: string, health: string | null, ago: number | null) => ({
  type: 'employer_site',
  id,
  domain,
  health,
  lastCheckedAt: ago === null ? null : NOW - ago * MIN,
});
const ats = (id: string, health: string | null, ago: number | null) => ({
  type: 'ats',
  id,
  health,
  lastCheckedAt: ago === null ? null : NOW - ago * MIN,
});

const FIRST_PAGE = [
  {
    companyKey: 'magnit-roznichnaia-set',
    name: 'МАГНИТ, Розничная сеть',
    class: 'site',
    vacancies: 9_828,
    placements: [site('site:magnit.com', 'magnit.com', null, null)],
  },
  {
    companyKey: 'sber',
    name: 'Сбер',
    class: 'site',
    vacancies: 5_878,
    placements: [site('site:src-fh-sber', 'sberbank.ru', 'healthy', 28)],
  },
  {
    companyKey: 'tsmg-holding',
    name: 'TSMG Holding',
    class: 'site',
    vacancies: 4_477,
    placements: [
      ats('ats:lever:tsmg', 'healthy', 490),
      site('site:tsmg.io', 'tsmg.io', null, null),
    ],
  },
  {
    companyKey: 'prolific-academic',
    name: 'Prolific Academic Ltd',
    class: 'ats',
    vacancies: 4_174,
    placements: [ats('ats:greenhouse:prolificacademicltd', 'error', 490)],
  },
  {
    companyKey: 'spacex',
    name: 'SpaceX',
    class: 'ats',
    vacancies: 3_972,
    placements: [ats('ats:greenhouse:spacex', 'degraded', 900)],
  },
];

const SECOND_PAGE = [
  {
    companyKey: 'rossiiskie-zheleznye-dorogi',
    name: 'Российские железные дороги',
    class: 'aggregator_only',
    vacancies: 3_951,
    placements: [],
  },
  {
    companyKey: 'mts',
    name: 'МТС',
    class: 'site',
    vacancies: 3_789,
    placements: [
      site('site:src-company-site-mts', 'mts.ru', 'healthy', 720),
      site('site:src-fh-mts', 'mts.ru', 'healthy', 125),
      site('site:job.mts.ru', 'mts.ru', null, null),
    ],
  },
  {
    companyKey: '0000050571-royal-bank-of-canada-singapore-branch',
    name: '0000050571 Royal Bank of Canada, Singapore Branch',
    class: 'none',
    vacancies: 0,
    placements: [],
  },
];

const ATS_PAGE = [FIRST_PAGE[3], FIRST_PAGE[4]];

async function stubCoverage(page: Page): Promise<string[]> {
  const companyRequests: string[] = [];
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { data: ADMINISTRATOR } }),
  );
  await page.route('**/api/v1/candidate/workspace', (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.route('**/api/v1/admin/directory/coverage', (route) =>
    route.fulfill({ json: { data: TOTALS } }),
  );
  await page.route('**/api/v1/admin/directory/coverage/companies?*', (route) => {
    const url = new URL(route.request().url());
    companyRequests.push(url.search);
    const cls = url.searchParams.get('class');
    const cursor = url.searchParams.get('cursor');
    if (cls === 'ats')
      return route.fulfill({ json: { data: { items: ATS_PAGE, nextCursor: null } } });
    if (cursor === 'p2')
      return route.fulfill({ json: { data: { items: SECOND_PAGE, nextCursor: null } } });
    return route.fulfill({ json: { data: { items: FIRST_PAGE, nextCursor: 'p2' } } });
  });
  return companyRequests;
}

async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Меню «Разделы» стоит у заголовка экрана, а не посреди высокой страницы. */
async function expectMenuAtHeader(page: Page): Promise<void> {
  const nav = await page.getByRole('navigation', { name: 'Разделы администратора' }).boundingBox();
  const head = await page.getByRole('heading', { name: 'Покрытие компаний' }).boundingBox();
  expect(nav && head).toBeTruthy();
  expect(Math.abs((nav?.y ?? 0) - (head?.y ?? 0))).toBeLessThanOrEqual(120);
}

test.describe('B643-11 company coverage', () => {
  test('shows totals, pages companies and switches classes without sideways scrolling', async ({
    page,
  }, testInfo) => {
    const requests = await stubCoverage(page);
    await page.goto('/admin?tab=coverage', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Покрытие компаний' })).toBeVisible();
    await expect(page.getByText('объявлений в пуле', { exact: true })).toBeVisible();
    await expect(page.getByText('sberbank.ru')).toBeVisible();
    await expect(page.getByText('Показано 5 из 261 964')).toBeVisible();
    await expectNoSideScroll(page);
    if (testInfo.project.name === 'desktop-1440') await expectMenuAtHeader(page);

    await page.getByRole('button', { name: 'Показать ещё 50' }).click();
    await expect(page.getByText('Российские железные дороги')).toBeVisible();
    await expect(page.getByText('Показаны все 8 компаний')).toBeVisible();
    await expect(page.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0);
    expect(requests.some((search) => search.includes('cursor=p2'))).toBe(true);
    await expectNoSideScroll(page);
    // Клик по «Показать ещё» прокручивает страницу, а меню липкое: снимок — сверху.
    await page.evaluate(() => window.scrollTo(0, 0));
    if (testInfo.project.name === 'desktop-1440') await expectMenuAtHeader(page);
    await page.screenshot({ path: testInfo.outputPath('coverage.png'), fullPage: true });

    await page
      .getByRole('group', { name: 'Способ размещения' })
      .getByRole('button', { name: 'ATS' })
      .click();
    await expect(
      page.getByRole('group', { name: 'Способ размещения' }).getByRole('button', { name: 'ATS' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Сбер', { exact: true })).toHaveCount(0);
    await expect(page.getByText('SpaceX', { exact: true })).toBeVisible();
    expect(requests.some((search) => search.includes('class=ats'))).toBe(true);
    await expectNoSideScroll(page);
  });

  test('a 403 shows the no-access state', async ({ page }) => {
    await stubCoverage(page);
    await page.route('**/api/v1/admin/directory/coverage', (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: 'forbidden', message: 'Недостаточно прав.', retryable: false } },
      }),
    );
    await page.goto('/admin?tab=coverage', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText('Экран доступен администраторам с правом управлять пулом вакансий.'),
    ).toBeVisible();
    await expectNoSideScroll(page);
  });
});
