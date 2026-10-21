import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { mockCandidateCompanies } from './fixtures/mockCandidateCompanies';

test.describe('B422 — все компании подборки в «Хочу» из подвала вакансий', () => {
  test('подтверждение, одна массовая операция, итог и выросший счёт «Хочу»', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-390', 'На 390 кнопки в подвале нет (макет 4).');
    await mockSignedInCabinet(page, { vacancyTotal: 148 });
    await mockCandidateCompanies(page, { companyCount: 61, wantedCompanyCount: 3 });
    const bulkRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/api/v1/candidate/companies/want')
      ) {
        bulkRequests.push(request.postData() ?? '');
      }
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
    await expect(page.locator('.vac-list-item').first()).toBeVisible();

    const footer = page.locator('.vacancies-screen-footer');
    await footer.getByRole('button', { name: 'Все компании подборки в «Хочу» (61)' }).click();
    await expect(footer.getByText('Добавить 61 компаний в «Хочу»?')).toBeVisible();
    await footer.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(footer.getByRole('status')).toHaveText('Добавлено 58, 3 уже в «Хочу».');
    expect(bulkRequests).toEqual([JSON.stringify({ scope: 'selection' })]);

    await page.getByRole('tab', { name: 'Компании и люди 61' }).click();
    await expect(page.getByRole('button', { name: 'Хочу 61', exact: true })).toBeVisible();
  });
});
