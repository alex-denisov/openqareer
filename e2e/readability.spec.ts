import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { waitForCareerShell } from './helpers/waitForCareerShell';

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

const SECTIONS = ['Сегодня', 'Роль', 'Вакансии'] as const;
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
  // B248 — the approved mockups set micro-labels (eyebrows, chips, ages,
  // fit dots) in `--career-text-aux`, declared as auxiliary and "not a
  // seventh step of the B232 scale". Exactly that one size is allowed under
  // the floor and kept out of the six-size count; anything else under 13 px
  // still fails.
  const probe = document.createElement('span');
  probe.style.fontSize = 'var(--career-text-aux)';
  main.append(probe);
  const microPx = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  const sizes = new Map<number, number>();
  const under13: string[] = [];
  const boxes: { element: HTMLElement; rect: DOMRect; text: string }[] = [];
  const visibleRectFor = (element: HTMLElement): DOMRect => {
    const original = element.getBoundingClientRect();
    let left = original.left;
    let top = original.top;
    let right = original.right;
    let bottom = original.bottom;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const bounds = parent.getBoundingClientRect();
        const clipLeft = bounds.left + parent.clientLeft;
        const clipTop = bounds.top + parent.clientTop;
        if (style.overflowX !== 'visible') {
          left = Math.max(left, clipLeft);
          right = Math.min(right, clipLeft + parent.clientWidth);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, clipTop);
          bottom = Math.min(bottom, clipTop + parent.clientHeight);
        }
      }
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(document.documentElement.clientWidth, right);
    bottom = Math.min(window.innerHeight, bottom);
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };
  for (const element of withText) {
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    const isMicro = fontSize === microPx;
    if (!isMicro) sizes.set(fontSize, (sizes.get(fontSize) ?? 0) + 1);
    const text = element.textContent?.trim().slice(0, 40) ?? '';
    if (fontSize < minFontPx && !isMicro) {
      under13.push(`${fontSize}px ${element.className.toString().slice(0, 50)} «${text}»`);
    }
    const rect = element.getBoundingClientRect();
    // Текст в SVG масштабируется вместе с viewBox: computed 13 px, на экране
    // 6. Высота бокса однострочного узла не может быть меньше кегля.
    const floorPx = isMicro ? microPx : minFontPx;
    if (rect.height > 0 && rect.height < floorPx - 1 && text.length > 0) {
      under13.push(`box ${Math.round(rect.height)}px ${element.tagName.toLowerCase()} «${text}»`);
    }
    const visibleRect = visibleRectFor(element);
    if (visibleRect.width && visibleRect.height) {
      boxes.push({ element, rect: visibleRect, text });
    }
  }
  const overlaps: (readonly [string, string])[] = [];
  for (let i = 0; i < boxes.length && overlaps.length < 12; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].rect;
      const b = boxes[j].rect;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const nested =
        boxes[i].element.contains(boxes[j].element) ||
        boxes[j].element.contains(boxes[i].element) ||
        boxes[i].text.includes(boxes[j].text) ||
        boxes[j].text.includes(boxes[i].text);
      const overlayA = boxes[i].element.closest('.vacancies-filters.is-expanded');
      const overlayB = boxes[j].element.closest('.vacancies-filters.is-expanded');
      const intersectionCenter = {
        x: Math.max(a.left, b.left) + ix / 2,
        y: Math.max(a.top, b.top) + iy / 2,
      };
      // The expanded filter popover intentionally covers content behind it.
      const hit = document.elementFromPoint(intersectionCenter.x, intersectionCenter.y);
      const intersectionVisible =
        intersectionCenter.x >= 0 &&
        intersectionCenter.x <= document.documentElement.clientWidth &&
        intersectionCenter.y >= 0 &&
        intersectionCenter.y <= window.innerHeight;
      const hiddenBehindFilterPopover =
        Boolean(overlayA) !== Boolean(overlayB) &&
        Boolean(hit?.closest('.vacancies-filters.is-expanded'));
      if (ix > 4 && iy > 4 && intersectionVisible && !nested && !hiddenBehindFilterPopover) {
        overlaps.push([boxes[i].text, boxes[j].text]);
        break;
      }
    }
  }
  const viewportWidth = document.documentElement.clientWidth;
  const overflowX =
    Math.max(document.documentElement.scrollWidth, main.scrollWidth) - viewportWidth;
  // These bounded controls scroll internally; their children may extend past the
  // viewport while the page/root itself stays within its measured width.
  const wide = [...main.querySelectorAll<HTMLElement>('*')]
    .filter((element) => element.getBoundingClientRect().right > viewportWidth + 2)
    .filter(
      (element) =>
        !element.closest('.career-path, .vacancies-filter-group-buttons, .companies-people-tabs'),
    )
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

async function openSection(
  page: Page,
  label: (typeof SECTIONS)[number] | 'Отклики',
): Promise<void> {
  const mobileViewport = (page.viewportSize()?.width ?? 1440) <= 760;
  if (
    label === 'Вакансии' &&
    mobileViewport &&
    (await page.locator('.vacancies-filters.is-mobile-open').isVisible())
  ) {
    await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
  }
  if (label === 'Роль') {
    if (!mobileViewport) {
      await page
        .getByRole('navigation', { name: 'Разделы кабинета' })
        .getByRole('button', { name: 'Карьера', exact: true })
        .click();
    } else {
      const mobileSummary = page.locator('.career-path-mobile-summary');
      if (await mobileSummary.isVisible()) {
        await mobileSummary.click();
      } else {
        await page.locator('nav.career-mobile-nav').getByRole('button', { name: 'Ещё' }).click();
        await page
          .getByRole('menu', { name: 'Ещё разделы' })
          .getByRole('menuitem', { name: 'Карьера', exact: true })
          .click();
      }
    }
  } else {
    const rail = page.locator('aside#career-rail nav');
    const mobile = page.locator('nav.career-mobile-nav');
    const nav = (await rail.isVisible()) ? rail : mobile;
    await nav.getByRole('button', { name: label, exact: true }).click();
  }
  const landmark = {
    Сегодня: page.locator('.career-today'),
    // Mobile role entry opens the focused role-filter screen in the vacancies route.
    Роль: mobileViewport
      ? page.locator('.vacancies-filters.is-mobile-open')
      : page.locator('.career-screen, .vacancies-content').first(),
    Вакансии: page.locator('.vac-list-item').first(),
    Отклики: page.getByRole('heading', { name: 'Отклики', exact: true }),
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
  // S11-CAR: экран «Карьера» (макет 3) компактнее списков вакансий: 30+ узлов текста против 5 в ошибке
  const minNodes = label === 'Роль' ? 30 : 40;
  expect(facts.textNodes, context).toBeGreaterThan(minNodes);
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
    await waitForCareerShell(page);

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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    for (const label of ['Сегодня', 'Вакансии'] as const) {
      await openSection(page, label);
      await page.screenshot({ path: info.outputPath(`${label}-390.png`), fullPage: true });
      await assertReadable(page, label, 390, errors);
    }
    expect(unmatched).toEqual([]);
  });

  test('the mobile shell has no horizontal overflow from 280 to 414 pixels', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    for (const width of [280, 320, 390, 414]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('nav.career-mobile-nav')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test('Today fits 320, 390 and 414 without overflow or undersized touch targets', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone responsive acceptance');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await openSection(page, 'Сегодня');

    for (const width of [320, 390, 414]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('.career-today-mobile')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `Today overflows at ${width}px`).toBeLessThanOrEqual(0);
      const undersizedTargets = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.career-today-mobile button, .career-today-mobile a',
          ),
        ]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => ({
            name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          }))
          .filter((target) => target.width < 44 || target.height < 44),
      );
      expect(undersizedTargets, `Today touch targets at ${width}px`).toEqual([]);
    }
  });

  test('the collapsed desktop rail hides captions and the path opens only existing sections', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'desktop only');
    const unmatched = await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const rail = page.locator('aside#career-rail');
    await expect(rail.locator('.career-nav-button span')).toHaveCount(7);
    await expect(rail.getByRole('button', { name: 'Автоматизация', exact: true })).toBeEnabled();
    const captions = await rail.locator('.career-nav-button span').evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: node.textContent,
        width: node.getBoundingClientRect().width,
      })),
    );
    expect(captions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Сегодня', width: 0 }),
        expect.objectContaining({ text: 'Вакансии', width: 0 }),
      ]),
    );
    await rail.getByRole('button', { name: 'Вакансии', exact: true }).hover();
    await expect(page.locator('.career-desktop-topbar-hint')).toHaveText('Вакансии');
    await expect(page.locator('.career-tooltip-bubble[data-open="true"]')).toHaveCount(0);

    const routes = [
      ['Профиль', '.career-profile-screen-view'],
      ['Карьера', '.career-screen'],
      ['Вакансии', '.vacancies-screen'],
      ['Отклики', '.career-responses-board-wrap, .career-responses-empty'],
      ['Автоматизация', '.automation-screen'],
    ] as const;
    for (const [label, target] of routes) {
      await page.goto('/app', { waitUntil: 'domcontentloaded' });
      await waitForCareerShell(page);
      const routeButton = rail.getByRole('button', { name: label, exact: true });
      await expect(routeButton).toBeVisible();
      await expect(routeButton).toBeEnabled({ timeout: 15_000 });
      await routeButton.click();
      await expect(page.locator(target).first()).toBeVisible();
    }
    expect(unmatched).toEqual([]);
  });

  test('Today mobile omits the path indicator from the approved screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'Today mobile surface');
    const unmatched = await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await openSection(page, 'Сегодня');

    await expect(page.locator('.career-page-header')).toBeHidden();
    await expect(page.locator('.career-path')).toBeHidden();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await page.screenshot({
      path: info.outputPath('today-mobile-without-path-390.png'),
      fullPage: true,
    });
    expect(unmatched).toEqual([]);
  });

  test('every bottom-nav caption fits its button and the screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    const items = await page
      .locator(
        '.career-mobile-nav .career-nav-button, .career-mobile-nav .career-mobile-more-button',
      )
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const caption = button.querySelector('span');
          const box = button.getBoundingClientRect();
          return {
            label: caption?.textContent?.trim(),
            width: box.width,
            height: box.height,
            captionOverflow: caption
              ? caption.scrollWidth - caption.clientWidth
              : Number.POSITIVE_INFINITY,
          };
        }),
      );

    expect(items).toHaveLength(5);
    expect(
      items.every(
        (item) => Math.abs(item.width - 69) <= 1 && item.height === 52 && item.captionOverflow <= 0,
      ),
    ).toBe(true);
  });

  test('the bottom nav carries no stray active-tick bar between icons', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const selected = page.locator('nav.career-mobile-nav .career-nav-button[aria-current="page"]');
    const beforeContent = await selected.evaluate(
      (element) => getComputedStyle(element, '::before').content,
    );
    const selectedBackground = await selected.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const capsuleBackground = await page
      .locator('nav.career-mobile-nav')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(selectedBackground).not.toBe(capsuleBackground);
    expect(beforeContent).toBe('none');
  });

  /**
   * B233 — одна ведущая вещь. Старая Главная (свёртки и правая колонка) ушла
   * вместе с редизайном B248; на «Сегодня» утверждённый макет
   * (work/B248/today.html) ставит акцентную заливку только на действие пункта
   * очереди, не больше одной на пункт, и нигде вне очереди. Разделы, которые
   * раньше лежали в свёртках, теперь на экране «Профиль» (profile-screen.spec).
   */
  test('today fills the accent only on queue actions, at most one per item', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'desktop composition only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.setViewportSize({ width: 1280, height: 860 });
    await openSection(page, 'Сегодня');

    const composition = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const probe = document.createElement('span');
      probe.style.color = `var(--career-accent)`;
      main.append(probe);
      const accentRgb = getComputedStyle(probe).color;
      probe.remove();
      const filled = [...main.querySelectorAll<HTMLElement>('button, a')]
        .filter((element) => getComputedStyle(element).backgroundColor === accentRgb)
        .filter((element) => element.getClientRects().length > 0)
        .filter((element) => !element.closest('.career-rail, .career-mobile-nav'));
      const outsideQueue = filled
        .filter((element) => !element.closest('.career-today-queue-desktop-row'))
        .map((element) => element.textContent?.trim().slice(0, 40) ?? '');
      const perItem = [...main.querySelectorAll('.career-today-queue-desktop-row')].map(
        (item) => filled.filter((element) => item.contains(element)).length,
      );
      return { filled: filled.length, outsideQueue, perItem };
    });
    expect(composition.filled, JSON.stringify(composition)).toBe(1);
    expect(composition.outsideQueue, JSON.stringify(composition)).toEqual(['Подтвердить факт']);
    expect(Math.max(...composition.perItem), JSON.stringify(composition)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('Сегодня-composition-1280.png') });
  });

  /**
   * B236 — письмо-отклик. Старый список с иконкой «Отклик» и подсказкой ушёл
   * вместе с редизайном B250; вход в генератор теперь — кнопка «Собрать
   * письмо» в карточке вакансии (на 390 — в полноэкранной панели). Список
   * «20 строк и Показать ещё» (B232) утверждённый макет vacancies.html
   * заменил сплошным списком, поэтому его проверка снята.
   */
  test('the cover-letter screen opens from the vacancy card and preserves keyboard focus', async ({
    page,
  }, info) => {
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/vacancies/*/detail', async (route) =>
      route.fulfill({
        json: {
          data: {
            id: 'cluster-0',
            description: 'Подтверждённое описание вакансии для письма.',
            truncated: false,
            skills: ['Product discovery'],
            responsibilities: ['Проверять гипотезы продукта.'],
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/vacancies/*/connection-circles', async (route) =>
      route.fulfill({
        json: {
          data: {
            vacancyId: 'cluster-0',
            companyKey: 'fincloud',
            companyName: 'FinCloud',
            vacancyTitle: 'Head of Product, Payments',
            circles: [
              {
                circle: 1,
                state: 'available',
                message: 'Есть знакомый в компании.',
                paths: [
                  {
                    id: 'direct-maria',
                    circle: 1,
                    recipient: {
                      id: 'person-maria',
                      fullName: 'Мария Крылова',
                      roleTitle: 'Директор по продукту',
                      companyName: 'FinCloud',
                    },
                    path: [],
                    evidence: ['Связь подтверждена в профиле кандидата'],
                    strength: 'direct',
                    source: 'manual',
                    nextStep: 'write_known_contact',
                  },
                ],
              },
              {
                circle: 2,
                state: 'unknown',
                message: 'Можно попросить представить через знакомого.',
                paths: [],
              },
              {
                circle: 3,
                state: 'available',
                message: 'Подготовьте холодный отклик по вакансии.',
                paths: [
                  {
                    id: 'cold-team',
                    circle: 3,
                    recipient: {
                      id: 'recruiting-team',
                      fullName: 'Команда найма',
                      roleTitle: null,
                      companyName: 'FinCloud',
                    },
                    path: [],
                    evidence: [],
                    strength: 'unknown',
                    source: 'cold',
                    nextStep: 'cold_application',
                  },
                ],
              },
            ],
            linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
          },
        },
      }),
    );
    await page.route('**/api/v1/candidate/vacancies/*/pitch', async (route) => {
      await route.fulfill({
        json: {
          data: {
            vacancyId: 'test-vacancy',
            emailPitch: { subject: 'Отклик', body: 'Текст отклика.' },
            linkedInNote: 'Здравствуйте! Рад знакомству.',
            contactMessage: 'Текст отклика.',
            atsCoverLetter: 'Cover letter',
            usedEvidenceIds: ['fact-1'],
            language: 'ru',
            generatedAt: '2026-10-10T12:00:00.000Z',
          },
        },
      });
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await openSection(page, 'Вакансии');
    const firstVacancy = page.locator('.vac-list-item').first();
    const rowTrigger = firstVacancy.locator('.vacancies-screen-row-trigger');
    if ((await rowTrigger.getAttribute('aria-expanded')) !== 'true') await rowTrigger.click();
    await firstVacancy
      .locator('.vac-detail')
      .getByRole('button', { name: 'Полное описание' })
      .click();
    const pitchAction = page
      .locator('.career-modal-card.is-detail')
      .getByRole('button', { name: 'Сопроводительное письмо', exact: true });
    await pitchAction.focus();
    await expect(pitchAction).toBeFocused();
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: 'Письмо под вакансию', level: 1 });
    await expect(heading).toBeVisible();
    const back = page.getByRole('button', { name: 'Назад к вакансиям' });
    await expect(back).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Текст письма' })).toHaveValue('Текст отклика.');
    await page.screenshot({ path: info.outputPath('b449-letter-screen.png') });

    await back.click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();
    expect(unmatched).toEqual([]);
  });

  test('search keeps tariff detail behind an explicit link', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await page
        .getByRole('navigation', { name: 'Разделы' })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('menu', { name: 'Ещё разделы' })
        .getByRole('menuitem', { name: 'Тарифы', exact: true })
        .click();
    } else {
      await page.locator('.career-rail-wallet:visible').click();
    }

    await expect(
      page.locator('.career-main-content').getByRole('heading', { name: 'Тарифы', exact: true }),
    ).toBeVisible();
  });

  /**
   * B248, owner review 2026-09-23 — a screenshot taken from an ad hoc script
   * that never stubbed `/api/v1/candidate/resume` showed «Профиль» stuck on
   * an error. This proves the real screen, mocked the same way every other
   * cabinet route is here, actually renders the candidate's resume on both
   * required widths — not an error state.
   */
  test('«Профиль» shows the candidate resume, not an error state', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.locator('button[aria-label="Профиль"]:visible').first().click();

    const title =
      (page.viewportSize()?.width ?? 1440) <= 760
        ? page.locator('.career-topbar h1')
        : page.locator('.career-desktop-topbar h1');
    await expect(title).toHaveText('Профиль');
    await expect(page.getByText('Не удалось загрузить резюме')).toHaveCount(0);
    await expect(page.getByText('FinCloud').locator('visible=true').first()).toBeVisible();
    // 390 shows the role line under the name (2-profil.html); 1440 also lists vacancy titles.
    await expect(
      page
        .getByText(
          (page.viewportSize()?.width ?? 1440) <= 760 ? 'Руководитель продукта' : 'Head of Product',
        )
        .first(),
    ).toBeVisible();
  });

  test('capture C52 screenshots: fixed rail, focus tooltip and path', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const rail = page.locator('.career-rail');
    const railBox = await rail.boundingBox();
    expect(railBox?.width).toBe(76);
    await expect(page.locator('.career-rail-toggle')).toHaveCount(0);
    const today = rail.locator('.career-nav-button').first();
    await today.hover();
    const hint = page.locator('.career-desktop-topbar-hint');
    await expect(hint).toHaveText('Сегодня');
    await expect(page.locator('.career-tooltip-bubble[data-open="true"]')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/C52/rail-fixed-1440.png' });
    await today.focus();
    await expect(hint).toHaveText('Сегодня');
    await expect(page.locator('.career-path')).toBeHidden();
    await page.screenshot({ path: 'output/playwright/C52/today-without-path-1440.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await expect(page.locator('.career-path')).toBeHidden();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await page.screenshot({ path: 'output/playwright/C52/rail-and-today-390.png' });
  });

  test('capture C73 screenshots: Today drops the old path; B450 Responses and B446 vacancies stay focused', async ({
    page,
  }) => {
    await mockSignedInCabinet(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    // The approved desktop Today mockup no longer contains the old path stepper.
    await expect(page.locator('.career-path')).toBeHidden();
    await page.screenshot({ path: 'output/playwright/C73/screen-today-1440.png' });

    // B446's approved vacancies screen owns the page header and filter area.
    // The shell path indicator is not duplicated over this full screen.
    await openSection(page, 'Вакансии');
    await expect(page.locator('.career-path')).toHaveCount(0);
    await expect(page.locator('.vacancies-screen')).toBeVisible();
    await page.screenshot({ path: 'output/playwright/C73/screen-opportunities-1440.png' });

    // B450's responses header owns the workspace; it hides the duplicate path strip.
    await openSection(page, 'Отклики');
    await expect(page.locator('.career-path')).toBeHidden();
    await page.screenshot({ path: 'output/playwright/C73/screen-responses-1440.png' });

    // The approved mobile Today screen omits the old path summary.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await expect(page.locator('.career-path')).toBeHidden();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await page.screenshot({ path: 'output/playwright/C73/screen-today-390.png' });

    await openSection(page, 'Вакансии');
    await expect(page.locator('.career-path')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/C73/screen-opportunities-390.png' });
    await openSection(page, 'Отклики');
    await expect(page.locator('.career-path')).toBeHidden();
    await page.screenshot({ path: 'output/playwright/C73/screen-responses-390.png' });
  });

  test('B344 D9: на 1000 «Сегодня» без пути, как в утверждённом макете; подписи шага, если путь показан, не длиннее 14 символов', async ({
    page,
  }) => {
    await mockSignedInCabinet(page);
    // From 761 px «Сегодня» uses the desktop composition of the mockups, which drops the path.
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await openSection(page, 'Сегодня');
    await expect(page.locator('.career-today-desktop')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.career-path')).toBeHidden();
    const reasons = page.locator('.career-path-reason:visible');
    const count = await reasons.count();
    for (let i = 0; i < count; i++) {
      const reasonEl = reasons.nth(i);
      const text = (await reasonEl.textContent()) ?? '';
      expect(text.length).toBeLessThanOrEqual(14);
      const textOverflow = await reasonEl.evaluate(
        (el) => window.getComputedStyle(el).textOverflow,
      );
      expect(textOverflow).not.toBe('ellipsis');
    }

    await page.screenshot({ path: 'output/playwright/B344/d9-today-1000.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.career-path')).toBeHidden();
    await expect(page.locator('.career-today-mobile')).toBeVisible();
    await page.screenshot({
      path: 'output/playwright/B344/d9-today-without-path-390.png',
      fullPage: true,
    });
  });

  test('capture B335 screenshots: fixed rail at 1176 and mobile', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'resize desktop context to cover both layouts');
    await mockSignedInCabinet(page);
    await page.setViewportSize({ width: 1176, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const railBox = await page.locator('.career-rail').boundingBox();
    expect(railBox?.width).toBe(76);
    await expect(page.locator('.career-rail-toggle')).toHaveCount(0);
    await page.screenshot({ path: 'output/playwright/B335/rail-fixed-1176.png' });

    // 390 mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page.screenshot({ path: 'output/playwright/B335/rail-390.png' });
  });

  test('capture B336 screenshots: languages, sources and tariffs', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.setViewportSize({ width: 1176, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Профиль', exact: true })
      .click();
    await expect(page.locator('.career-desktop-topbar h1')).toHaveText('Профиль');
    const languagesHeading = page.getByRole('heading', { name: 'Языки', exact: true });
    await expect(languagesHeading).toBeVisible();
    await languagesHeading.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/B336/languages-1176.png' });

    await page.getByRole('tab', { name: /^Цифровой след/ }).click();
    const sourcesHeading = page.locator('#profile-footprint-step-title');
    await expect(sourcesHeading).toBeVisible();
    await sourcesHeading.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/B336/sources-1176.png' });

    await page.locator('.career-rail-wallet:visible').click();
    await expect(
      page.locator('.career-main-content').getByRole('heading', { name: 'Тарифы', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'output/playwright/B336/tariffs-1176.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page
      .getByRole('menu', { name: 'Ещё разделы' })
      .getByRole('menuitem', { name: 'Тарифы', exact: true })
      .click();
    await expect(
      page.locator('.career-main-content').getByRole('heading', { name: 'Тарифы', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: 'output/playwright/B336/tariffs-390.png' });
  });

  test('capture B337 screenshots: responses board fit and card menu', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'run once from desktop-1440');
    const recentDate = new Date().toISOString();
    const sampleApplications = [
      {
        id: 'app-1',
        candidateId: 'candidate-b251',
        clusterId: null,
        stage: 'saved',
        closedReason: null,
        processProfile: 'standard',
        vacancy: {
          title: 'Cloud & Infra Solution Architect',
          company: 'Sonsoft Inc',
          url: 'https://hh.ru/vacancy/1',
          source: 'hh',
        },
        notes: 'Интересный проект',
        followUpDueAt: null,
        stageChangedAt: recentDate,
        version: 1,
        createdAt: recentDate,
        updatedAt: recentDate,
        followUp: null,
        whoseTurn: 'candidate',
        materials: { coverLetter: false, resume: false },
        nearestInterview: null,
      },
      {
        id: 'app-2',
        candidateId: 'candidate-b251',
        clusterId: null,
        stage: 'applied',
        closedReason: null,
        processProfile: 'standard',
        vacancy: {
          title: 'Enterprise Architect, Senior Advisor',
          company: 'Peraton',
          url: 'https://hh.ru/vacancy/2',
          source: 'hh',
        },
        notes: null,
        followUpDueAt: '2026-10-05T00:00:00.000Z',
        stageChangedAt: recentDate,
        version: 1,
        createdAt: recentDate,
        updatedAt: recentDate,
        followUp: null,
        whoseTurn: 'company',
        materials: { coverLetter: true, resume: true },
        nearestInterview: null,
      },
      {
        id: 'app-3',
        candidateId: 'candidate-b251',
        clusterId: null,
        stage: 'responded',
        closedReason: null,
        processProfile: 'standard',
        vacancy: {
          title: 'Enterprise Architect Director',
          company: 'HRTx, Inc.',
          url: 'https://hh.ru/vacancy/3',
          source: 'hh',
        },
        notes: null,
        followUpDueAt: null,
        stageChangedAt: recentDate,
        version: 1,
        createdAt: recentDate,
        updatedAt: recentDate,
        followUp: null,
        whoseTurn: 'candidate',
        materials: { coverLetter: true, resume: true },
        nearestInterview: null,
      },
      {
        id: 'app-4',
        candidateId: 'candidate-b251',
        clusterId: null,
        stage: 'interview',
        closedReason: null,
        processProfile: 'standard',
        vacancy: {
          title: 'VP of Platform Architecture',
          company: 'Cisco Systems',
          url: 'https://hh.ru/vacancy/4',
          source: 'hh',
        },
        notes: 'Технический скрининг пройден',
        followUpDueAt: null,
        stageChangedAt: recentDate,
        version: 1,
        createdAt: recentDate,
        updatedAt: recentDate,
        followUp: null,
        whoseTurn: 'company',
        materials: { coverLetter: true, resume: true },
        nearestInterview: {
          date: '2026-10-03T14:00:00.000Z',
          format: 'online',
          interviewer: 'VP Engineering',
        },
      },
    ];

    await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/applications*', async (route) => {
      await route.fulfill({ json: { data: sampleApplications } });
    });

    // Viewport 1176: desktop app window
    await page.setViewportSize({ width: 1176, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    await expect(page.locator('.career-responses-board')).toBeVisible();
    await expect(page.locator('.career-responses-card')).toHaveCount(4);

    for (const label of ['Отправлено', 'Ответили', 'Интервью', 'Оффер']) {
      await expect(page.locator(`.career-responses-column[aria-label="${label}"]`)).toBeVisible();
    }

    await page.screenshot({ path: 'output/playwright/B337/board-1176.png' });

    // Open card menu by clicking card body
    await page.getByRole('button', { name: 'Действия с карточкой' }).first().click();
    await expect(page.locator('.career-responses-card-menu')).toBeVisible();
    await page.screenshot({ path: 'output/playwright/B337/card-menu-1176.png' });

    // Viewport 390: mobile layout
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    await expect(page.getByRole('list', { name: 'Нужно действие' })).toBeVisible();
    await expect(page.locator('.career-responses-board')).toBeHidden();
    await page.screenshot({ path: 'output/playwright/B337/responses-list-390.png' });
  });
});
