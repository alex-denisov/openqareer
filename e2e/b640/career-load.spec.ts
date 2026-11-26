import { expect, test, type Page } from '@playwright/test';
import { openCareer } from './careerFixture';

/**
 * B792: «Карьера» не ждёт медленные чтения. Задержки — как на проде 26.11
 * (замер CPO): сессия 1,1 с, роли 5,8 с, число вакансий подборки 15 с.
 */
const API = '**/api/v1';
const SEARCH_ROLES = [
  'Руководитель разработки',
  'CTO',
  'VP of Engineering',
  'Head of IT Operations',
  'IT Director',
  'Head of ITSM',
  'Chief Operating Officer',
  'AI Consultant',
  'Customer Support Director',
  'Chief Customer Officer',
  'AI Solutions Architect',
];

export interface Delays {
  readonly session: number;
  readonly status: number;
  readonly campaign: number;
  readonly roles: number;
  readonly count: number;
  readonly skills: number;
}

export const PROD_DELAYS: Delays = {
  session: 1_100,
  status: 170,
  campaign: 200,
  roles: 5_800,
  count: 15_000,
  skills: 1_300,
};

/** Прод 26.11 21:00, сетевые времена по Resource Timing: сессия 0,2 с, роли 0,5–1,3 с. */
const NOW_DELAYS: Delays = {
  session: 210,
  status: 120,
  campaign: 175,
  roles: 1_300,
  count: 5_800,
  skills: 1_300,
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Задержка поверх ответа фикстуры: обработчик, поставленный позже, срабатывает первым. */
async function slow(page: Page, url: string | ((url: URL) => boolean), ms: number) {
  await page.route(url, async (route) => {
    await pause(ms);
    await route.fallback();
  });
}

/** Устройство, где кабинет уже открывался: ранние чтения уходят рядом с вопросом о сессии. */
export async function openSlowCareer(page: Page, delays: Delays = PROD_DELAYS): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('oq_cabinet_b640', '1'));
  await openCareer(page, '/app/career', { searchRoles: SEARCH_ROLES });
  await slow(page, `${API}/auth/me`, delays.session);
  await slow(page, `${API}/candidate/status`, delays.status);
  await slow(page, `${API}/candidate/campaign`, delays.campaign);
  await slow(page, (url) => url.pathname.endsWith('/candidate/role-hypotheses'), delays.roles);
  await slow(page, `${API}/candidate/b640/matched-vacancies*`, delays.count);
  await slow(page, `${API}/candidate/role-skill-assessments/current*`, delays.skills);
}

const screen = (page: Page) => page.locator('[data-b640-node="s09"]');

test.describe('B792: «Карьера» частями', () => {
  test.setTimeout(60_000);

  test('роль поиска до ролей, на месте медленных частей — скелетоны', async ({ page }) => {
    await openSlowCareer(page);
    await page.goto('/app/career');
    const s09 = screen(page);
    // Роль поиска — первым блоком, роли ещё считаются.
    await expect(s09.locator('#role-title')).toHaveText('Руководитель разработки и ещё 10', {
      timeout: 4_000,
    });
    await expect(s09.getByRole('status', { name: 'Считаем вакансии' })).toBeVisible();
    await expect(s09.getByRole('status', { name: 'Подбираем роли' })).toBeVisible();
    await expect(s09.locator('.c9-table, .c9-acc')).toHaveCount(0);
    // Роли пришли — скелетон ролей уходит, число вакансий ещё считается.
    await expect(s09.getByRole('heading', { name: /Роли по вашему профилю/u })).toBeVisible({
      timeout: 10_000,
    });
    await expect(s09.getByRole('status', { name: 'Подбираем роли' })).toHaveCount(0);
    await expect(s09.getByRole('status', { name: 'Считаем вакансии' })).toBeVisible();
    await expect(s09.getByText(/64 вакансии/u)).toBeVisible({ timeout: 20_000 });
    await expect(s09.getByRole('status', { name: 'Считаем вакансии' })).toHaveCount(0);
  });

  test('пока статус и роль поиска не прочитаны — каркас полосы роли и ролей', async ({ page }) => {
    await openSlowCareer(page, { ...PROD_DELAYS, status: 3_000, campaign: 3_000 });
    await page.goto('/app/career');
    const s09 = screen(page);
    await expect(s09.getByRole('status', { name: 'Роль поиска' })).toBeVisible({ timeout: 4_000 });
    await expect(s09.getByRole('status', { name: 'Подбираем роли' })).toBeVisible();
    await expect(s09.locator('#role-title')).toHaveText('Руководитель разработки и ещё 10', {
      timeout: 6_000,
    });
    await expect(s09.getByRole('status', { name: 'Роль поиска' })).toHaveCount(0);
  });
});

/** Когда часть экрана появилась впервые, мс от начала перехода. */
const MARKS = {
  boot: '[data-testid="cabinet-b640-boot"]',
  shell: '.b640',
  skeleton: '[data-b640-node="s09"] [aria-busy="true"]',
  role: '[data-b640-node="s09"] #role-title',
  roles: '[data-b640-node="s09"] .c9-table, [data-b640-node="s09"] .c9-acc',
} as const;

async function watchMarks(page: Page): Promise<void> {
  await page.addInitScript((marks: Record<string, string>) => {
    const seen: Record<string, number> = {};
    (window as unknown as { b792: Record<string, number> }).b792 = seen;
    const check = () => {
      for (const [name, selector] of Object.entries(marks)) {
        if (seen[name] === undefined && document.querySelector(selector)?.isConnected)
          seen[name] = Math.round(performance.now());
      }
      if (
        seen.count === undefined &&
        /\d+ ваканси/u.test(
          document.querySelector('[data-b640-node="s09"] .role-strip-n')?.textContent ?? '',
        )
      )
        seen.count = Math.round(performance.now());
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, MARKS);
}

// B792_MEASURE=cpo|now: замер частей под задержками прода, печатает JSON (в CI не идёт).
test('B792 замер: части «Карьеры» под задержками прода', async ({ page }, info) => {
  test.skip(!process.env.B792_MEASURE, 'замер по запросу');
  test.setTimeout(60_000);
  await watchMarks(page);
  const now = process.env.B792_MEASURE === 'now';
  await openSlowCareer(page, now ? NOW_DELAYS : PROD_DELAYS);
  await page.goto('/app/career');
  await expect(screen(page).getByText(/64 вакансии/u)).toBeVisible({ timeout: 30_000 });
  const marks = await page.evaluate(() => {
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      fcp: paint ? Math.round(paint.startTime) : null,
      session: Math.round(
        performance.getEntriesByType('resource').find((entry) => entry.name.includes('/auth/me'))
          ?.responseEnd ?? 0,
      ),
      ...(window as unknown as { b792: Record<string, number> }).b792,
    };
  });
  console.log(`B792 ${now ? 'now' : 'cpo'} ${info.project.name} ${JSON.stringify(marks)}`);
});
