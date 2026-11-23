import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer } from './careerFixture';
import { expectGates } from './gates';
import { baseRun, openSkillCheck, type SkillOptions } from './skillCheckFixture';

const SHOTS = process.env.B640_SHOTS;
const PATH = '/app/career/skills';
const node = (page: Page, code: string) =>
  page.locator(`[data-b640-node="${code}"]:not([data-b640-state]), [data-b640-state="${code}"]`);

/**
 * B645 c04 на 390: «Пропустить · продолжу позже» строкой над «Ответить», по правому краю;
 * «Ответить» не уже половины полосы и не выходит за поле 16 px.
 */
async function expectDockLikeMockup(page: Page, screen: ReturnType<typeof node>) {
  if ((page.viewportSize()?.width ?? 0) >= 768) return;
  const answer = await screen.getByRole('button', { name: 'Ответить' }).boundingBox();
  const skip = await screen
    .getByRole('button', { name: 'Пропустить · продолжу позже' })
    .boundingBox();
  expect(answer && skip).toBeTruthy();
  if (!answer || !skip) return;
  expect(skip.y + skip.height).toBeLessThanOrEqual(answer.y + 1);
  expect(answer.width).toBeGreaterThanOrEqual(178);
  expect(answer.x + answer.width).toBeCloseTo(374, 0);
  expect(skip.x + skip.width).toBeCloseTo(382, 0);
  expect(skip.x).toBeGreaterThanOrEqual(16);
}

test.describe('B653: «Карьера» — проверка навыков C04', () => {
  test('C4: старт по роли, кейс, итог C4b и следующий кейс; гейты', async ({ page }) => {
    const calls = await openSkillCheck(
      page,
      `${PATH}?role=${encodeURIComponent('Руководитель разработки')}`,
      {
        ready: true,
      },
    );
    const screen = node(page, 'c04');
    // Без промежуточного экрана: первый вопрос открывается сразу (B645, макет C4).
    await expect(screen.getByText('Управление сроками · вопрос 5 из 6')).toBeVisible();
    expect(calls.posts[0]).toEqual({ path: 'start', body: { role: 'Руководитель разработки' } });
    await expect(screen.getByRole('button', { name: 'Начать проверку' })).toHaveCount(0);
    const criteria = screen.locator('.change');
    await expect(criteria.getByRole('heading', { name: 'Оценим по трём пунктам' })).toBeVisible();
    await expect(criteria.locator('li')).toHaveCount(3);
    await expect(screen.getByRole('heading', { name: /сорвала срок релиза/u })).toBeVisible();
    await expectGates(page);
    // Текущий навык помечен в списке навыков роли, как в макете C4.
    await screen.locator('details.more-n > summary').click();
    await expect(screen.locator('.exp-rows .row-sub')).toHaveText(['Идёт сейчас · 5 из 6']);
    await expectDockLikeMockup(page, screen);
    await page.mouse.move(0, 0);
    await screen.getByLabel('Ваш ответ').fill('Разберу причины с командой и назову новый срок.');
    await screen.getByRole('button', { name: 'Ответить' }).click();
    const result = node(page, 'c04b');
    await expect(result.getByRole('heading', { name: 'Раскрыты все 3 пункта' })).toBeVisible();
    await expect(
      result.getByText('В профиль попадёт: «Управление сроками — подтверждено кейсом». Верно?'),
    ).toBeVisible();
    await expect(result.locator('.tag.ok')).toHaveCount(3);
    await result.getByRole('button', { name: 'Подтвердить навык' }).click();
    await expect(node(page, 'c04').getByText('Kubernetes · вопрос 6 из 6')).toBeVisible();
    await expect(node(page, 'c04').getByLabel('Ваш ответ')).toHaveValue('');
  });

  test('C4: сбой оценки — строка на месте, ответ остался, «Повторить» тем же запросом', async ({
    page,
  }) => {
    const calls = await openSkillCheck(page, PATH, { failAnswers: 1 });
    const screen = node(page, 'c04');
    await screen.getByLabel('Ваш ответ').fill('Мой ответ');
    await screen.getByRole('button', { name: 'Ответить' }).click();
    await expect(screen.getByRole('alert')).toContainText('Оценка не получилась');
    await expect(screen.getByLabel('Ваш ответ')).toHaveValue('Мой ответ');
    await screen.getByRole('button', { name: 'Повторить' }).click();
    await expect(
      node(page, 'c04b').getByRole('heading', { name: 'Раскрыты все 3 пункта' }),
    ).toBeVisible();
    const answers = calls.posts.filter((post) => post.path.endsWith('/answer'));
    expect(answers).toHaveLength(2);
    expect(answers[0]?.body.requestId).toBe(answers[1]?.body.requestId);
  });

  test('C4: «Пройти ещё раз» возвращает прежний ответ в поле', async ({ page }) => {
    await openSkillCheck(page, PATH);
    const screen = node(page, 'c04');
    await screen.getByLabel('Ваш ответ').fill('Первый ответ');
    await screen.getByRole('button', { name: 'Ответить' }).click();
    await node(page, 'c04b').getByRole('button', { name: 'Пройти ещё раз' }).click();
    await expect(node(page, 'c04').getByText('Управление сроками · вопрос 5 из 6')).toBeVisible();
    await expect(node(page, 'c04').getByLabel('Ваш ответ')).toHaveValue('Первый ответ');
  });

  test('C4: разговор о роли, затем факты в профиль', async ({ page }) => {
    const calls = await openSkillCheck(page, PATH, {
      run: baseRun('dialogue'),
    } satisfies SkillOptions);
    const screen = node(page, 'c04');
    await expect(screen.getByText('О вашем опыте · вопрос 1 из 6')).toBeVisible();
    await screen.getByLabel('Ваш ответ').fill('Команда из 12 человек');
    await screen.getByRole('button', { name: 'Ответить' }).click();
    await expect(screen.getByRole('heading', { name: 'Что добавить в профиль' })).toBeVisible();
    await screen.getByLabel('Планировал релизы по кварталам').uncheck();
    await screen.getByRole('button', { name: 'Добавить в профиль · 1' }).click();
    await expect(screen.getByText('Go, PostgreSQL · вопрос 4 из 6')).toBeVisible();
    const saved = calls.posts.find((post) => post.path.endsWith('/suggestions'));
    expect(
      (saved?.body.suggestions as Array<{ accepted: boolean }>).map((item) => item.accepted),
    ).toEqual([true, false]);
  });

  test('C4 без роли: берётся первая роль поиска с готовой проверкой (B645)', async ({ page }) => {
    const calls = await openSkillCheck(page, PATH, {
      ready: true,
      searchRoles: ['VP of Engineering', 'Руководитель разработки'],
      insufficient: ['VP of Engineering'],
    });
    await expect(node(page, 'c04').getByText('Управление сроками · вопрос 5 из 6')).toBeVisible();
    expect(calls.posts[0]).toEqual({ path: 'start', body: { role: 'Руководитель разработки' } });
  });

  test('C4: мало требований — короткая строка и выбор роли на месте (B645)', async ({ page }) => {
    await openSkillCheck(page, `${PATH}?role=${encodeURIComponent('VP of Engineering')}`, {
      ready: true,
      searchRoles: ['VP of Engineering', 'CTO', 'Руководитель разработки'],
      insufficient: ['VP of Engineering', 'CTO'],
    });
    const screen = node(page, 'c04');
    // B726 (прод 23.11): роль, которую тоже нельзя проверить, в выбор не попадает — второй тупик.
    await expect(screen.getByRole('link', { name: /^Проверить «/u })).toHaveCount(1);
    await expect(screen.locator('.re-line')).toHaveText(
      'По роли «VP of Engineering» в вакансиях мало требований для проверки.',
    );
    await expect(screen.getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(screen.getByText(/ещё собираются/u)).toHaveCount(0);
    await screen.getByRole('link', { name: 'Проверить «Руководитель разработки»' }).click();
    await expect(screen.getByText('Управление сроками · вопрос 5 из 6')).toBeVisible();
  });

  test('B767: два варианта одной роли с одним русским названием — на выбор одна роль', async ({
    page,
  }) => {
    await openSkillCheck(page, `${PATH}?role=${encodeURIComponent('VP of Engineering')}`, {
      ready: true,
      searchRoles: ['VP of Engineering', 'Head of Technical Support', 'Customer Support Director'],
      insufficient: ['VP of Engineering'],
      titlesRu: {
        'Head of Technical Support': 'Руководитель службы поддержки',
        'Customer Support Director': 'Руководитель службы поддержки',
      },
    });
    const screen = node(page, 'c04');
    await expect(screen.getByRole('link', { name: /^Проверить «/u })).toHaveCount(1);
    await expect(
      screen.getByRole('link', { name: 'Проверить «Руководитель службы поддержки»' }),
    ).toBeVisible();
  });

  test('C4: «Пропустить · продолжу позже» ведёт к ролям', async ({ page }) => {
    await openSkillCheck(page, PATH);
    await node(page, 'c04').getByRole('button', { name: 'Пропустить · продолжу позже' }).click();
    await expect(page).toHaveURL(/\/app\/career$/u);
  });

  test('S9: «Проверить» открывает проверку роли поиска', async ({ page }) => {
    await openCareer(page, '/app/career');
    await expect(
      page.locator('.sk-strip').getByRole('link', { name: 'Проверить' }),
    ).toHaveAttribute('href', `${PATH}?role=${encodeURIComponent('Руководитель разработки')}`);
  });

  for (const [name, answer] of [
    ['c04-proverka-navykov', false],
    ['c04b-proverka-itog', true],
  ] as const) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      await openSkillCheck(page, PATH);
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(PATH, { waitUntil: 'domcontentloaded' });
        const field = node(page, 'c04').getByLabel('Ваш ответ');
        await field.fill(
          'Сначала разберу с командой, где застряли: обычно это зависимость от другой команды. Заказчику в тот же день скажу новый срок и что мы отрезаем из объёма…',
        );
        if (answer) {
          await node(page, 'c04').getByRole('button', { name: 'Ответить' }).click();
          await expect(node(page, 'c04b').locator('.lead-title')).toBeVisible();
        }
        for (const width of desktop ? [1440, 1176] : [390]) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
});
