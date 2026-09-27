const SECTION_SELECTORS = {
  Сегодня: '.career-today, .career-today-state',
  Профиль: '.career-profile-screen-view',
  Вакансии: '.vacancies-screen',
  Отклики: '.career-responses-empty, .career-responses-board-wrap',
};

export async function waitForScreenReady(page) {
  await page.waitForFunction(
    () => {
      const main = document.querySelector('#career-main');
      if (!main) return false;
      const hasScreen = main.querySelector(
        '.career-today, .career-today-state, .career-profile-screen-view, .vacancies-screen, .career-responses-empty, .career-responses-board-wrap, [role="alert"]',
      );
      const loading = main.querySelector(
        '[aria-busy="true"], .career-profile-screen-state[role="status"]',
      );
      return Boolean(hasScreen) && !loading;
    },
    null,
    { timeout: 60_000 },
  );
}

export async function clickCabinetSection(page, section, viewport) {
  const nav =
    viewport === '390'
      ? page.getByRole('navigation', { name: 'Основная навигация' })
      : page.getByRole('complementary', { name: 'Основная навигация' }).getByRole('navigation');
  await nav.getByRole('button', { name: section, exact: true }).click({ timeout: 8_000 });
  const selector = SECTION_SELECTORS[section];
  if (!selector) throw new Error('неизвестный раздел кабинета: ' + section);
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 });
  await waitForScreenReady(page);
}
