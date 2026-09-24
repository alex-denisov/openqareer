import { expect, test, type Page } from '@playwright/test';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
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

const SECTIONS = ['Сегодня', 'Роль', 'Вакансии'] as const;
const DESKTOP_WIDTHS = [1176, 1280, 1440] as const;
const MAX_DISTINCT_SIZES = 6;
const MIN_FONT_PX = 13;
const CAPTION_SLACK_PX = 4;

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
  const boxes: { rect: DOMRect; text: string }[] = [];
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
  // B248 — `.career-path` is a deliberate horizontal scroller on narrow
  // screens (the path indicator's five steps never shrink or wrap, per the
  // owner's 2026-09-23 review). Its own box never exceeds the viewport
  // (`overflowX` above already proves that); only its children legitimately
  // extend past it, which is what a horizontal scroller is. Nothing else in
  // the shell is exempt.
  const wide = [...main.querySelectorAll<HTMLElement>('*')]
    .filter((element) => element.getBoundingClientRect().right > viewportWidth + 2)
    .filter((element) => !element.closest('.career-path'))
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
    if (path.endsWith('/candidate/today')) {
      return route.fulfill({ json: { data: todaySnapshot } });
    }
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/applications')) {
      return route.fulfill({ json: { data: [] } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
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
      // B248, owner review 2026-09-23 — this shape used to disagree with
      // `ResumeStudioProjection`/`ResumeEvidenceFreshness`
      // (`server/domain/resumeStudioTypes.ts`): `evidenceFreshness.stale`
      // is an array the surface calls `.length` on, not a boolean, and it
      // crashed into the error boundary the moment «Профиль» started
      // opening this screen instead of a copy of «Сегодня». The client
      // rebuilds its own projection from the draft and never reads this
      // one, but the shape still has to be honest.
      const emptyDocument = {
        kind: 'master',
        targetRole: null,
        contact: { fullName: null, email: null, phone: null, location: null, links: [] },
        experience: [],
        education: [],
        languages: [],
        unknowns: [],
        conventions: {
          country: null,
          packVersion: null,
          reverseChronological: true,
          maxPages: null,
          recommendedBulletsPerRole: null,
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
        length: { lines: 0, pages: 1, linesPerPage: 45 },
      };
      return route.fulfill({
        json: {
          data: {
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
            },
            projection: {
              master: emptyDocument,
              germanyVariant: { ...emptyDocument, kind: 'country-role' },
              evidenceSnapshot: [],
              excludedEvidenceIds: [],
            },
            evidenceFreshness: { valid: true, stale: [] },
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
  if (label === 'Роль') {
    // «Поиск» has no rail item in the B248 IA (Сегодня · Профиль · Вакансии ·
    // Отклики · Консультант); it opens from the path indicator's «Роль»
    // step instead (career-consultant-notes.md §2).
    await page
      .getByRole('button', { name: /^Роль\./ })
      .first()
      .click();
  } else {
    const rail = page.locator('aside#career-rail nav');
    const mobile = page.locator('nav.career-mobile-nav');
    const nav = (await rail.isVisible()) ? rail : mobile;
    await nav.getByRole('button', { name: label, exact: true }).click();
  }
  const landmark = {
    Сегодня: page.locator('.career-today'),
    Роль: page.locator('.career-campaign-tile').first(),
    Вакансии: page.locator('.vac-list-item').first(),
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

  /**
   * B248, owner review 2026-09-23 — the phone build once wrapped the path
   * indicator's five steps onto two rows, and «Профиль»'s label ran into
   * «Роль»'s dot. The mockup keeps one row and scrolls horizontally instead;
   * this asserts that directly rather than trusting a screenshot.
   */
  test('the path indicator on the phone stays one row without wrapping or overlapping labels', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    const unmatched = await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await openSection(page, 'Сегодня');

    const steps = page.locator('.career-path-step');
    await expect(steps).toHaveCount(5);

    const facts = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('.career-path-step')];
      const tops = nodes.map((node) => Math.round(node.getBoundingClientRect().top));
      const dots = nodes.map((node) =>
        node.querySelector('.career-path-dot')?.getBoundingClientRect(),
      );
      const labels = nodes.map((node) =>
        node.querySelector('.career-path-label')?.getBoundingClientRect(),
      );
      const overlaps: string[] = [];
      for (let i = 0; i < labels.length; i += 1) {
        const label = labels[i];
        if (!label) continue;
        for (let j = 0; j < dots.length; j += 1) {
          if (j === i) continue;
          const dot = dots[j];
          if (!dot) continue;
          const ix = Math.min(label.right, dot.right) - Math.max(label.left, dot.left);
          const iy = Math.min(label.bottom, dot.bottom) - Math.max(label.top, dot.top);
          if (ix > 2 && iy > 2) overlaps.push(`step ${i} label × step ${j} dot`);
        }
      }
      return { singleRow: new Set(tops).size === 1, tops, overlaps };
    });

    expect(facts.singleRow, JSON.stringify(facts)).toBe(true);
    expect(facts.overlaps, JSON.stringify(facts)).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  /**
   * B248, owner review 2026-09-23 (390px) — the rail's left-edge active tick
   * floated between «Сегодня» and «Профиль» in the bottom nav, with nothing
   * for it to mark there. Colour alone still names the active item.
   */
  /**
   * CI 2026-09-25: «Консультант» in a fifth of 390 px ran 1.3 px past the
   * screen on Linux fonts and failed every screen's overflow check. Every
   * caption must fit its own button, so the strip never depends on metrics.
   */
  test('every bottom-nav caption fits its button and the screen', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    const spills = await page.evaluate((minSlack) => {
      const cw = document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('.career-mobile-nav .career-nav-button')]
        .map((button) => {
          const caption = button.querySelector('span')?.getBoundingClientRect();
          const box = button.getBoundingClientRect();
          if (!caption) return null;
          // 4 px of headroom on each side absorbs font-metric drift between
          // macOS and the Linux CI runner.
          const slack = Math.min(
            box.right - caption.right,
            caption.left - box.left,
            cw - caption.right,
          );
          return slack < minSlack
            ? `${button.textContent?.trim()} slack ${slack.toFixed(2)}px`
            : null;
        })
        .filter(Boolean);
    }, CAPTION_SLACK_PX);
    expect(spills).toEqual([]);
  });

  test('the bottom nav carries no stray active-tick bar between icons', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-390', 'phone only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const beforeContent = await page
      .locator('nav.career-mobile-nav .career-nav-button.is-active')
      .first()
      .evaluate((el) => getComputedStyle(el, '::before').content);
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
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
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
        .filter((element) => !element.closest('.career-rail, .career-mobile-nav'));
      const outsideQueue = filled
        .filter((element) => !element.closest('.career-today-item'))
        .map((element) => element.textContent?.trim().slice(0, 40) ?? '');
      const perItem = [...main.querySelectorAll('.career-today-item')].map(
        (item) => filled.filter((element) => item.contains(element)).length,
      );
      return { filled: filled.length, outsideQueue, perItem };
    });
    expect(composition.filled, JSON.stringify(composition)).toBeGreaterThan(0);
    expect(composition.outsideQueue, JSON.stringify(composition)).toEqual([]);
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
  test('the cover-letter modal opens from the vacancy card and keeps keyboard focus', async ({
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
    if (info.project.name === 'mobile-390') {
      await page.locator('.vac-list-item').first().locator('.vac-row').click();
    }

    const pitchAction = page
      .locator('.vacancies-detail-col')
      .getByRole('button', { name: 'Собрать письмо', exact: true });
    await pitchAction.click();
    const dialog = page.getByRole('dialog', { name: /Отклик:/u });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'LinkedIn-заметка (300 знаков)' }).click();
    await expect(dialog.getByText('Здравствуйте! Рад знакомству.')).toBeVisible();
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
    await openSection(page, 'Роль');

    await expect(page.locator('.career-automation-list')).toHaveCount(0);
    await page.getByRole('button', { name: 'Посмотреть тарифы', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Сколько делать за вас', exact: true }),
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
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
    await page.locator('button[aria-label="Профиль"]:visible').first().click();

    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить резюме')).toHaveCount(0);
    await expect(page.getByText('FinCloud').first()).toBeVisible();
    await expect(page.getByText('Head of Product').first()).toBeVisible();
  });
});
