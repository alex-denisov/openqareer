import { expect, test, type Page } from '@playwright/test';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  workspace,
} from './fixtures/readabilityWorkspace';

/**
 * B232 — читаемость кабинета как гейт, а не как разовый аудит.
 *
 * Аудит 2026-09-20 насчитал на Главной 24 кегля и 55 % текста мельче 12 px,
 * а строку «Вакансий» — на 125 px шире окна с 12 наложениями. Ни одна из
 * этих цифр не видна из статической разметки: кегль — вычисленный стиль,
 * переполнение и наложение — факты раскладки. Поэтому замер живёт здесь, на
 * тех же трёх разделах и на ширинах окна десктопа (1176), конфигурации
 * `tauri.conf.json` (1280), большого экрана (1440) и телефона (390).
 */

const SECTIONS = ['Главная', 'Поиск', 'Вакансии'] as const;
const DESKTOP_WIDTHS = [1176, 1280, 1440] as const;
const MAX_DISTINCT_SIZES = 6;
const MIN_FONT_PX = 13;

interface ReadabilityFacts {
  readonly textNodes: number;
  readonly sizes: readonly (readonly [number, number])[];
  readonly under13: readonly string[];
  readonly overflowX: number;
  readonly wide: readonly string[];
  readonly overlaps: readonly (readonly [string, string])[];
}

/** Считает то же, что `audits/2026-09-20-design-readability/measure-readability.mjs`. */
function measure(minFontPx: number): ReadabilityFacts {
  const main = document.querySelector('main') ?? document.body;
  const withText = [...main.querySelectorAll<HTMLElement>('*')].filter((element) => {
    const ownText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!ownText || getComputedStyle(element).visibility === 'hidden') return false;
    // Содержимое закрытого <details> Chromium прячет через content-visibility:
    // боксы у него есть, на экране его нет.
    const fold = element.closest('details:not([open])');
    return !fold || element.closest('summary') !== null;
  });
  const sizes = new Map<number, number>();
  const under13: string[] = [];
  const boxes: { rect: DOMRect; text: string }[] = [];
  for (const element of withText) {
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    sizes.set(fontSize, (sizes.get(fontSize) ?? 0) + 1);
    const text = element.textContent?.trim().slice(0, 40) ?? '';
    if (fontSize < minFontPx) {
      under13.push(`${fontSize}px ${element.className.toString().slice(0, 50)} «${text}»`);
    }
    const rect = element.getBoundingClientRect();
    // Текст в SVG масштабируется вместе с viewBox: computed 13 px, на экране
    // 6. Высота бокса однострочного узла не может быть меньше кегля.
    if (rect.height > 0 && rect.height < minFontPx - 1 && text.length > 0) {
      under13.push(`box ${Math.round(rect.height)}px ${element.tagName.toLowerCase()} «${text}»`);
    }
    if (rect.width && rect.height) boxes.push({ rect, text });
  }
  const overlaps: (readonly [string, string])[] = [];
  for (let i = 0; i < boxes.length && overlaps.length < 12; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].rect;
      const b = boxes[j].rect;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const nested = boxes[i].text.includes(boxes[j].text) || boxes[j].text.includes(boxes[i].text);
      if (ix > 4 && iy > 4 && !nested) {
        overlaps.push([boxes[i].text, boxes[j].text]);
        break;
      }
    }
  }
  const viewportWidth = document.documentElement.clientWidth;
  const overflowX =
    Math.max(document.documentElement.scrollWidth, main.scrollWidth) - viewportWidth;
  const wide = [...main.querySelectorAll<HTMLElement>('*')]
    .filter((element) => element.getBoundingClientRect().right > viewportWidth + 2)
    .slice(0, 5)
    .map(
      (element) =>
        `${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 40)} right=${Math.round(element.getBoundingClientRect().right)} «${element.textContent?.trim().slice(0, 30) ?? ''}»`,
    );
  return {
    textNodes: withText.length,
    sizes: [...sizes.entries()].sort((a, b) => b[1] - a[1]),
    under13: under13.slice(0, 20),
    overflowX,
    wide,
    overlaps,
  };
}

/** Кабинет, упавший в границу ошибки, «читаем» по пяти узлам — это не замер. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page:${error.message}\n${error.stack ?? ''}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  return errors;
}

/**
 * Мок отвечает только на то, что знает. Неизвестный маршрут получал бы
 * `{ data: null }`, экран рисовал бы пустое состояние, и гейт проходил бы на
 * тонком экране; вместо этого путь записывается и тест падает по списку.
 */
async function mockSignedInCabinet(page: Page): Promise<string[]> {
  const unmatched: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: candidate } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    if (path.endsWith('/account')) {
      return route.fulfill({ json: { data: account } });
    }
    if (
      path.endsWith('/candidate/me/memory') ||
      path.endsWith('/candidate/me/turns') ||
      path.endsWith('/candidate/me/messages')
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path.endsWith('/candidate/role-hypotheses')) {
      return route.fulfill({ json: { data: roleHypotheses } });
    }
    if (path.endsWith('/candidate/resume')) {
      return route.fulfill({
        json: {
          data: {
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
            },
            projection: { variants: [] },
            evidenceFreshness: { stale: false, staleMemoryIds: [] },
          },
        },
      });
    }
    if (path.endsWith('/candidate/matched-vacancies')) {
      return route.fulfill({
        json: matchedVacancyPage(Number(url.searchParams.get('offset') ?? 0)),
      });
    }
    if (
      path.endsWith('/candidate/vacancy-subscriptions') ||
      path.endsWith('/candidate/vacancy-sources') ||
      path.endsWith('/candidate/vacancy-applications') ||
      path.endsWith('/candidate/connections') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
    }
    if (
      path.endsWith('/candidate/strategy') ||
      path.endsWith('/candidate/work-preferences') ||
      path.endsWith('/candidate/reputation-audit') ||
      path.endsWith('/candidate/desktop-tunnel')
    ) {
      return route.fulfill({ json: { data: null } });
    }
    unmatched.push(path);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  return unmatched;
}

async function openSection(page: Page, label: (typeof SECTIONS)[number]): Promise<void> {
  const rail = page.locator('aside#career-rail nav');
  const mobile = page.locator('nav.career-mobile-nav');
  const nav = (await rail.isVisible()) ? rail : mobile;
  await nav.getByRole('button', { name: label, exact: true }).click();
  const landmark = {
    Главная: page.locator('.career-profile-tabs'),
    Поиск: page.locator('.career-campaign-tile').first(),
    Вакансии: page.locator('.career-vacancy-row').first(),
  }[label];
  await expect(landmark).toBeVisible();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function assertReadable(
  page: Page,
  label: string,
  width: number,
  errors: readonly string[],
): Promise<void> {
  const facts = await page.evaluate(measure, MIN_FONT_PX);
  const context = `${label} @ ${width}: ${JSON.stringify(facts, null, 1)}`;
  expect(errors, context).toEqual([]);
  expect(facts.textNodes, context).toBeGreaterThan(40);
  expect(facts.sizes.length, context).toBeLessThanOrEqual(MAX_DISTINCT_SIZES);
  expect(facts.under13, context).toEqual([]);
  expect(facts.overflowX, context).toBeLessThanOrEqual(0);
  expect(facts.wide, context).toEqual([]);
  expect(facts.overlaps, context).toEqual([]);
}

test.describe('B232 readability gate', () => {
  test('desktop windows keep six sizes, a 13 px floor and no overflow', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'desktop widths only');
    const errors = collectPageErrors(page);
    const unmatched = await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    for (const width of DESKTOP_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      for (const label of SECTIONS) {
        await openSection(page, label);
        await page.screenshot({ path: info.outputPath(`${label}-${width}.png`), fullPage: true });
        await assertReadable(page, label, width, errors);
      }
    }
    expect(unmatched).toEqual([]);
  });

  test('the phone keeps the same scale and never scrolls sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    const errors = collectPageErrors(page);
    const unmatched = await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    for (const label of SECTIONS) {
      await openSection(page, label);
      await page.screenshot({ path: info.outputPath(`${label}-390.png`), fullPage: true });
      await assertReadable(page, label, 390, errors);
    }
    expect(unmatched).toEqual([]);
  });

  test('the vacancy list shows twenty rows and grows on request', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'one browser is enough');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await openSection(page, 'Вакансии');

    const rows = page.locator('.career-vacancy-row');
    await expect(rows).toHaveCount(20);
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(rows).toHaveCount(40);

    // Смена фильтра возвращает к первой странице: «показано 40 из 12» — ложь.
    await page.getByPlaceholder('Роль, вакансия или компания…').fill('Merchant');
    await expect(rows).toHaveCount(16);
    await expect(page.getByRole('button', { name: /Показать ещё/ })).toHaveCount(0);
    await page.getByPlaceholder('Роль, вакансия или компания…').fill('');
    await expect(rows).toHaveCount(20);
  });

  /**
   * B233 — одна ведущая вещь. На Главной глазу некуда было сесть: правая
   * колонка из четырёх равных блоков на полтора экрана и три акцентные заливки
   * («Проверить факты», «Начать разговор», «Улучшить блок»×N). Первое место —
   * одно, и это следующее действие кандидата; правая колонка не длиннее левой.
   */
  test('the home screen has one accent-filled action and a right column no taller than the left', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'desktop composition only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await page.setViewportSize({ width: 1280, height: 860 });
    await openSection(page, 'Главная');

    const composition = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--career-accent');
      const main = document.querySelector('main') ?? document.body;
      const probe = document.createElement('span');
      probe.style.color = `var(--career-accent)`;
      main.append(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.remove();
      const filled = [...main.querySelectorAll<HTMLElement>('button, a')]
        .filter((element) => getComputedStyle(element).backgroundColor === accentRgb)
        .filter((element) => !element.closest('.career-rail, .career-mobile-nav'))
        .map((element) => element.textContent?.trim().slice(0, 40) ?? '');
      const left = document.querySelector('.career-home-main')?.getBoundingClientRect().height ?? 0;
      const right =
        document.querySelector('.career-home-rail')?.getBoundingClientRect().height ?? 0;
      return { accent: accent.trim(), filled, left: Math.round(left), right: Math.round(right) };
    });
    expect(composition.filled, JSON.stringify(composition)).toHaveLength(1);
    // Допуск в один шаг сетки: колонки заканчиваются вместе, а не «правая
    // на полтора экрана длиннее», как было в аудите (3 005 против 733 px).
    expect(composition.right, JSON.stringify(composition)).toBeLessThanOrEqual(
      composition.left + 24,
    );

    // Остальные разделы не исчезли — они свёрнуты под профилем.
    const folds = page.locator('.career-home-fold > summary');
    await expect(folds).toHaveText([
      'ATS-читаемость',
      'Роли и рынок',
      'Позиционирование',
      'Карьерный консультант',
    ]);
    await folds.first().scrollIntoViewIfNeeded();
    await folds.first().click();
    await expect(page.locator('.career-home-fold[open] .career-ats-card')).toBeVisible();
    await page.screenshot({ path: info.outputPath('Главная-folds-1280.png') });
  });

  test('vacancy actions expose focus tooltips and the pitch modal keeps keyboard focus', async ({
    page,
  }, info) => {
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/vacancies/*/pitch', async (route) => {
      await route.fulfill({
        json: {
          data: {
            emailPitch: { subject: 'Отклик', body: 'Текст отклика.' },
            linkedInNote: 'Здравствуйте! Рад знакомству.',
            atsCoverLetter: 'Cover letter',
            usedEvidenceIds: ['fact-1'],
          },
        },
      });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await openSection(page, 'Вакансии');

    const pitchAction = page.getByRole('button', { name: 'Отклик', exact: true }).first();
    await pitchAction.focus();
    await expect(
      page.getByRole('tooltip').filter({ hasText: 'Сопроводительное письмо' }),
    ).toBeVisible();
    await expect(pitchAction).toHaveAttribute('aria-describedby', /.+/u);
    await page.screenshot({ path: info.outputPath('b236-tooltip-focused.png') });

    await pitchAction.click();
    const dialog = page.getByRole('dialog', { name: /Подготовка отклика/u });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'LinkedIn Note' }).click();
    await expect(dialog.getByRole('button', { name: 'Кому отправить' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('b236-pitch-modal.png') });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(pitchAction).toBeFocused();
    expect(unmatched).toEqual([]);
  });

  test('search keeps tariff detail behind an explicit link', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await openSection(page, 'Поиск');

    await expect(page.locator('.career-automation-list')).toHaveCount(0);
    await page.getByRole('button', { name: 'Посмотреть тарифы', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Сколько делать за вас', exact: true }),
    ).toBeVisible();
  });
});
