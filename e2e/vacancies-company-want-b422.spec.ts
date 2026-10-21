import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const KEY = 'c'.repeat(24);

/** Компании ещё нет в списке кандидата: поиск пуст, пока её не отметят «Хочу». */
async function mockCompanyWants(page: Page) {
  const state = { wanted: undefined as string | undefined, puts: 0, deletes: 0 };
  await page.route('**/api/v1/candidate/company-wants', async (route) => {
    const { companyName } = route.request().postDataJSON() as { companyName: string };
    state.wanted = companyName;
    state.puts += 1;
    await route.fulfill({ json: { data: { key: KEY, name: companyName, want: true } } });
  });
  await page.route('**/api/v1/candidate/companies**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/v1/candidate/companies/${KEY}/want`) {
      state.wanted = undefined;
      state.deletes += 1;
      return route.fulfill({ json: { data: { want: false } } });
    }
    const items = state.wanted
      ? [
          {
            key: KEY,
            name: state.wanted,
            location: null,
            industry: null,
            vacancyCount: 1,
            contactsCount: null,
            contactsImportedAt: null,
            want: true,
            nextStep: null,
            hasRecruiter: false,
            recruiterSearchStatus: 'idle',
            sources: [],
            vacancies: [],
            recruiters: [],
          },
        ]
      : [];
    return route.fulfill({
      json: { data: { items, total: items.length, offset: 0, limit: 20, filterCounts: {} } },
    });
  });
  return state;
}

async function openFirstVacancy(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  const item = page.locator('.vac-list-item').first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  const trigger = item.locator('.vacancies-screen-row-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  // B549/B446-g4: на 390 строка открывает push-экран вакансии, а не раскрытие в списке.
  const push = page.locator('.vacancy-push');
  return (await push.isVisible()) ? push : item.locator('.vac-detail');
}

test('B422: «Хочу в эту компанию» works for a company outside the candidate list', async ({
  page,
}) => {
  await mockSignedInCabinet(page);
  const state = await mockCompanyWants(page);
  const detail = await openFirstVacancy(page);
  await detail.getByRole('button', { name: 'Хочу в эту компанию' }).click();
  await expect(detail.getByRole('button', { name: 'Убрать из «Хочу»' })).toBeVisible();
  expect(state.puts).toBe(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloaded = await openFirstVacancy(page);
  const remove = reloaded.getByRole('button', { name: 'Убрать из «Хочу»' });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(reloaded.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();
  expect(state.deletes).toBe(1);
});
