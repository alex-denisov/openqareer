// CJM 3 — Ежедневная подборка → решение по вакансии.
// Извлекает топ-20 строк списка «Вакансии» (заголовок + видимый текст
// строки) в data/top20.json — сырьё для ручной разметки релевантности
// (см. scorecard/relevance-template.md). Учётка: adenisov.test.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm3(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm3', statePath, outDir);

  await run.gotoBoth('/app', 6000);

  await run.step('vacancies-open', {
    wait: 8000,
    note: 'Раздел «Вакансии» — список подборки',
    act: async (page) => {
      await page
        .locator('nav')
        .getByRole('button', { name: /^Вакансии/ })
        .first()
        .click();
    },
  });

  // Топ-20 строк на широкой ширине — источник ручной разметки релевантности.
  const page1440 = run.pages['1440'];
  const rows = await page1440
    .locator('.career-vacancy-row')
    .evaluateAll((els) =>
      els.slice(0, 20).map((el, i) => ({
        index: i + 1,
        title: el.querySelector('.career-vacancy-title')?.textContent?.trim() ?? '',
        text: el.textContent?.trim().slice(0, 300) ?? '',
      })),
    )
    .catch(() => []);
  writeFileSync(join(outDir, 'top20.json'), JSON.stringify(rows, null, 2));
  console.log(`[cjm3] извлечено строк топ-20: ${rows.length}`);

  const first = run.pages['1440'].locator('.career-vacancy-row').first();
  await run.step('vacancy-card', {
    wait: 3000,
    note: 'Открыта ли карточка вакансии (описание, требования) при клике на первую строку',
    act: async (page, vp) => {
      if (vp !== '1440') return;
      await first.click({ timeout: 5000 });
    },
  });

  for (const action of ['Сохранить', 'Пропустить']) {
    await run.step(`decision-${action}`, {
      wait: 2000,
      note: `Кнопка «${action}» на строке вакансии — доступна ли и просит ли причину`,
      act: async (page, vp) => {
        if (vp !== '1440') return;
        const btn = page
          .locator('.career-vacancy-row')
          .first()
          .getByRole('button', { name: new RegExp(`^${action}`) })
          .first();
        if (await btn.isVisible().catch(() => false)) await btn.click();
        else throw new Error(`кнопка «${action}» не найдена в строке`);
      },
    });
  }

  const result = await run.close();
  return {
    cjm: 'CJM3',
    title: 'Ежедневная подборка и решение',
    top20Count: rows.length,
    ...result,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm3';
  const r = await runCjm3(outDir);
  console.log(
    JSON.stringify(
      {
        cjm: r.cjm,
        steps: r.steps.map((s) => s.name),
        top20Count: r.top20Count,
        consoleErrors: r.consoleErrors,
      },
      null,
      2,
    ),
  );
}
