import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from '../fixtures/readabilityWorkspace';

/**
 * B726 (прод cc3f72de и 6edcbdd4, B645): вакансия Telegram с пустой canonicalCompany ломала всю
 * «Подборку» — ссылка v10b без companyId. Строка показывает компанию текстом, раздел на месте.
 */
const TOTAL = 45;
const BARE_ID = 'cluster-tg-it_vakansii_udalenka-2838';
const TG_POST = 'https://t.me/it_vakansii_udalenka/2838';

type Page50 = ReturnType<typeof matchedVacancyPage>;

function withBareFirst(page: Page50, offset: number): Page50 {
  if (offset !== 0) return page;
  const [first, ...rest] = page.data;
  if (!first) return page;
  // Сегодняшняя: строка проходит «Дату: 30 дней» у «Вакансий по роли».
  const now = new Date().toISOString();
  const bare = {
    ...first,
    cluster: {
      ...first.cluster,
      firstObservedAt: now,
      sources: [
        {
          ...first.cluster.sources[0],
          sourceType: 'telegram',
          sourceId: 'tg-it_vakansii_udalenka',
          sourceName: 'IT вакансии удалёнка',
          sourceUrl: TG_POST,
          observedAt: now,
        },
      ],
      primaryUrl: TG_POST,
      id: BARE_ID,
      canonicalTitle: 'Технический директор / Tech lead / CTO',
      canonicalCompany: '',
    },
  };
  return { ...page, data: [bare, ...rest] as Page50['data'] };
}

async function open(page: Page, path: string): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true, vacancyTotal: TOTAL });
  // Позже зарегистрированный маршрут отвечает первым: те же строки, первая — без компании.
  await page.route('**/api/v1/candidate/**matched-vacancies**', (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit')) || 50;
    return route.fulfill({ json: withBareFirst(matchedVacancyPage(offset, TOTAL, limit), offset) });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

for (const path of ['/app/vacancies', '/app/vacancies?role=CTO&date=30']) {
  test(`B726: строка без компании не роняет «Подборку» — ${path}`, async ({ page }) => {
    await open(page, path);
    const bare = page.locator('.b640 tr.vt-row', {
      hasText: 'Технический директор / Tech lead / CTO',
    });
    await expect(bare).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
    await expect(bare.locator('.vt-co')).toHaveText('Компания не указана');
    await expect(bare.locator('a.vt-co')).toHaveCount(0);
    // Соседние строки с компанией — ссылки на карточку компании, как раньше (с «Датой» их нет).
    if (path.includes('date=')) return;
    await expect(page.locator('.b640 tr.vt-row a.vt-co').first()).toHaveAttribute(
      'href',
      /\/app\/vacancies\/companies\//u,
    );
  });
}

/** B726 (B645, прод 23.11): v04 поста Telegram без компании — без пустого «О компании» и «сайта работодателя». */
test('B726: карточка вакансии без компании — источник назван постом Telegram', async ({ page }) => {
  await open(page, `/app/vacancies/${BARE_ID}`);
  const link = page.getByRole('link', { name: 'Открыть пост в Telegram' });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute('href', TG_POST);
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
  await expect(page.getByText('Открыть на сайте работодателя')).toHaveCount(0);
  await expect(page.getByText('Сайт компании')).toHaveCount(0);
  await expect(page.locator('.b640 .v4-about-co')).toHaveCount(0);
});
