import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { waitForCareerShell } from './helpers/waitForCareerShell';

/**
 * B589: a repeat visit to a cabinet section shows its content from the client
 * cache before the network answers. Every API answer is delayed by
 * NETWORK_DELAY_MS, so a section that waits for the server cannot pass the
 * REPEAT_BUDGET_MS bar; a section served from the cache passes it with room.
 */
const NETWORK_DELAY_MS = 1_200;
const REPEAT_BUDGET_MS = 300;
const CANDIDATE_ID = 'candidate-b589';

const SECTIONS = [
  { view: 'today', label: 'Сегодня' },
  { view: 'profile', label: 'Профиль' },
  { view: 'career', label: 'Карьера' },
  { view: 'opportunities', label: 'Вакансии' },
  { view: 'responses', label: 'Отклики' },
  { view: 'automation', label: 'Автоматизация' },
] as const;

type SectionView = (typeof SECTIONS)[number]['view'];

async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript((candidateId) => {
    window.localStorage.setItem(
      'candidate-workspace',
      JSON.stringify({
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        resumeText: 'Руководитель продукта с результатами в финтехе.',
        resumeSource: 'text',
        targetDirection: 'Руководитель продукта',
        regions: ['ru'],
        currentSituation: 'Ищу роль руководителя продукта.',
        constraints: 'Гибрид',
        urgency: 'active',
        outcomes: [],
      }),
    );
    window.localStorage.setItem('candidate-workspace-owner', candidateId);
  }, CANDIDATE_ID);
}

/**
 * Clicks the rail button and measures, inside the page, the time until the
 * shell shows the target view with no skeleton or busy marker in the content.
 */
async function measureTransition(page: Page, view: SectionView, label: string): Promise<number> {
  return page.evaluate(
    ({ targetView, buttonLabel }) =>
      new Promise<number>((resolve, reject) => {
        const nav = document.querySelector('nav[aria-label="Разделы кабинета"]');
        const button = [...(nav?.querySelectorAll('button') ?? [])].find(
          (candidate) => candidate.textContent?.trim() === buttonLabel,
        );
        if (!button) {
          reject(new Error(`no rail button ${buttonLabel}`));
          return;
        }
        // A background refresh may keep aria-busy on rendered content; only a
        // skeleton or a «Загружаем…» placeholder means the content is not there.
        const loadingSelector = [
          '[aria-busy="true"]',
          '[class*="skeleton"]',
          '[class*="-loading"]',
          '.is-loading',
        ].join(',');
        const isPlaceholder = (element: HTMLElement) =>
          element.getAttribute('aria-busy') !== 'true' ||
          /^\s*Загруж/u.test(element.textContent ?? '');
        const isReady = () => {
          const shell = document.querySelector('[data-shell-view]');
          if (shell?.getAttribute('data-shell-view') !== targetView) return false;
          const main = shell.querySelector('main') ?? shell;
          const busy = [...main.querySelectorAll<HTMLElement>(loadingSelector)].some(
            (element) => element.getClientRects().length > 0 && isPlaceholder(element),
          );
          return !busy && (main.textContent ?? '').trim().length > 0;
        };
        const started = performance.now();
        button.click();
        const deadline = started + 15_000;
        const tick = () => {
          const now = performance.now();
          if (isReady()) resolve(Math.round(now - started));
          else if (now > deadline) {
            const shell = document.querySelector('[data-shell-view]');
            const busy = [...(shell?.querySelectorAll<HTMLElement>(loadingSelector) ?? [])]
              .filter((element) => element.getClientRects().length > 0 && isPlaceholder(element))
              .map((element) => `${element.tagName}.${element.className}`)
              .slice(0, 5);
            reject(
              new Error(
                `${targetView} not ready in 15 s (view ${shell?.getAttribute('data-shell-view')}, busy ${busy.join(' | ')})`,
              ),
            );
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { targetView: view, buttonLabel: label },
  );
}

test.describe('B589 section cache', () => {
  test('repeat visit to every cabinet section renders before the network answers', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Rail navigation is the 1440 layout.');
    test.setTimeout(120_000);
    await mockSignedInCabinet(page, { candidateId: CANDIDATE_ID });
    await page.route('**/api/v1/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
      await route.fallback();
    });
    await seedWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);
    await expect(page.locator('[data-shell-view="today"]')).toBeVisible();
    // The rail unlocks the sections once the career picture is known.
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы кабинета' })
        .getByRole('button', { name: 'Автоматизация', exact: true }),
    ).toBeEnabled({ timeout: 20_000 });

    const first: Record<string, number> = {};
    const repeat: Record<string, number> = {};
    for (const section of [...SECTIONS.slice(1), SECTIONS[0]]) {
      first[section.view] = await measureTransition(page, section.view, section.label);
    }
    for (const section of [...SECTIONS.slice(1), SECTIONS[0]]) {
      repeat[section.view] = await measureTransition(page, section.view, section.label);
    }
    testInfo.annotations.push({
      type: 'b589-transitions',
      description: JSON.stringify({ delayMs: NETWORK_DELAY_MS, first, repeat }),
    });
    console.log(`B589 transitions ${JSON.stringify({ first, repeat })}`);

    for (const section of SECTIONS) {
      expect(repeat[section.view], `${section.view} repeat visit`).toBeLessThan(REPEAT_BUDGET_MS);
    }
  });
});
