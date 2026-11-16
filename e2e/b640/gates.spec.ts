import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates, GATES, runGates, type GateName } from './gates';
import { sizesForWindow } from './gates/common';

const VIEWS = ['', '?view=buttons', '?view=composer'] as const;

async function openKit(page: Page, query = ''): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.goto(`/app/kit${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-kit]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

interface BrokenExample {
  readonly gate: GateName;
  /** На каком окне у гейта есть размеры. */
  readonly on: 'desktop' | 'mobile' | 'both';
  readonly query?: string;
  readonly what: string;
  /** Ломает открытую витрину так, как ошибся бы разработчик экрана. */
  readonly spoil: (page: Page) => Promise<void>;
}

const BROKEN: readonly BrokenExample[] = [
  {
    gate: 'first_screen',
    on: 'mobile',
    what: 'заголовок экрана уехал ниже первого экрана телефона',
    spoil: (page) =>
      page.evaluate(() => {
        const main = document.querySelector('#career-main') as HTMLElement;
        (main.querySelector('.page') as HTMLElement).style.paddingBlockStart = '800px';
      }),
  },
  {
    gate: 'primary_pinned',
    on: 'mobile',
    what: 'главная кнопка на 390 стоит в потоке, а не в закреплённой полосе',
    spoil: (page) =>
      page.evaluate(() => {
        for (const strip of document.querySelectorAll<HTMLElement>('.act-dock, .m-commit')) {
          strip.style.position = 'static';
        }
      }),
  },
  {
    gate: 'spacing',
    on: 'both',
    what: 'поле отъехало от своей подписи больше чем на 8 px',
    spoil: (page) =>
      page.evaluate(() => {
        const label = document.querySelector(
          '#career-main label[for]:not(.vh)',
        ) as HTMLLabelElement;
        const field = document.getElementById(label.htmlFor) as HTMLElement;
        field.style.marginBlockStart = '40px';
      }),
  },
  {
    gate: 'modal_fit',
    on: 'both',
    query: '?open=dialog',
    what: 'окно выше экрана: подвал с главной кнопкой не виден',
    spoil: (page) =>
      page.evaluate(() => {
        const dialog = document.querySelector('.pf-dialog') as HTMLElement;
        dialog.style.maxBlockSize = 'none';
        dialog.style.blockSize = '2000px';
      }),
  },
  {
    gate: 'row_actions',
    on: 'both',
    what: 'в строке списка появилась залитая главная кнопка',
    spoil: (page) =>
      page.evaluate(() => {
        const action = document.querySelector('#career-main .row-act') as HTMLElement;
        action.classList.add('btn', 'is-primary');
      }),
  },
  {
    gate: 'field_height',
    on: 'both',
    what: 'поле в ряду формы выше соседних',
    spoil: (page) =>
      page.evaluate(() => {
        const field = document.querySelector(
          '#career-main [data-kit="form-row"] input',
        ) as HTMLElement;
        field.style.blockSize = '64px';
      }),
  },
  {
    gate: 'desktop_bottom',
    on: 'desktop',
    what: '«Аккаунт» в рейле ушёл за нижний край окна',
    spoil: (page) =>
      page.evaluate(() => {
        (document.querySelector('.rail .rail-end') as HTMLElement).style.transform =
          'translateY(400px)';
      }),
  },
];

test.describe('B649: гейты макетов B640 на витрине', () => {
  test('семь гейтов зелёные на каждом виде витрины', async ({ page }) => {
    const checked = new Map<GateName, number>();
    for (const query of VIEWS) {
      await openKit(page, query);
      const reports = await runGates(page);
      expect(reports.map((report) => report.gate)).toEqual(GATES.map((gate) => gate.name));
      for (const report of reports) {
        checked.set(report.gate, (checked.get(report.gate) ?? 0) + report.checked);
      }
      await expectGates(page);
    }
    // Окно проверяет только modal_fit: с открытым окном на экране две залитые кнопки (страница и окно).
    await openKit(page, '?open=dialog');
    const [modalFit] = await runGates(page, { only: ['modal_fit'] });
    checked.set('modal_fit', (checked.get('modal_fit') ?? 0) + modalFit.checked);
    const width = page.viewportSize()?.width ?? 0;
    for (const gate of GATES) {
      if (sizesForWindow(gate.sizes, width).length === 0) continue;
      expect(checked.get(gate.name) ?? 0, `гейт ${gate.name} проверил хоть что-то`).toBeGreaterThan(
        0,
      );
    }
  });

  test('гейты зелёные при открытом окне', async ({ page }) => {
    await openKit(page, '?open=dialog');
    await expect(page.getByRole('dialog')).toBeVisible();
    const [modalFit] = await runGates(page, { only: ['modal_fit'] });
    expect(modalFit.checked, 'окно попало в проверку').toBeGreaterThan(0);
    await expectGates(page, {
      only: ['modal_fit', 'first_screen', 'primary_pinned', 'field_height'],
    });
  });

  for (const example of BROKEN) {
    test(`гейт ${example.gate} падает на сломанном примере: ${example.what}`, async ({
      page,
    }, testInfo) => {
      const desktop = testInfo.project.name === 'desktop-1440';
      test.skip(
        example.on !== 'both' && (example.on === 'desktop') !== desktop,
        'у гейта нет размеров для этого окна',
      );
      await openKit(page, example.query);
      const [before] = await runGates(page, { only: [example.gate] });
      expect(before.checked, 'гейту есть что проверять на витрине').toBeGreaterThan(0);
      expect(before.failures, 'до поломки гейт зелёный').toEqual([]);

      await example.spoil(page);
      const [after] = await runGates(page, { only: [example.gate] });
      expect(after.failures.length, 'после поломки гейт называет нарушение').toBeGreaterThan(0);
      await expect(expectGates(page, { only: [example.gate] })).rejects.toThrow(/Гейты B640/u);
    });
  }
});
