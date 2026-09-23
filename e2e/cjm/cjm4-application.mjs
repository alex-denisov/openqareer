// CJM 4 — Отклик: письмо и версия резюме → переход → фиксация.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm4(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm4', statePath, outDir);

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page) => {
      await page
        .locator('nav')
        .getByRole('button', { name: /^Вакансии/ })
        .first()
        .click();
    },
  });

  await run.step('application-open', {
    wait: 4000,
    note: 'Модал/панель отклика на первой строке — письмо, версия резюме, факты профиля',
    act: async (page, vp) => {
      if (vp !== '1440') return;
      const row = page.locator('.career-vacancy-row').first();
      await row
        .getByRole('button', { name: /^Отклик/ })
        .first()
        .click();
    },
  });

  await run.step('application-letter', {
    wait: 3000,
    note: 'Текст письма — построено из фактов профиля или содержит служебные заглушки',
  });

  const result = await run.close();
  return { cjm: 'CJM4', title: 'Отклик и фиксация', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm4';
  const r = await runCjm4(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors },
      null,
      2,
    ),
  );
}
