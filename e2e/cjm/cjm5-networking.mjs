// CJM 5 — Нетворкинг: кто в компании → сообщение → учёт.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm5(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm5', statePath, outDir);

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page) => {
      await page.locator('nav').getByRole('button', { name: /^Вакансии/ }).first().click();
    },
  });

  await run.step('networking-open', {
    wait: 8000,
    note: 'Кнопка «Нетворкинг» на первой строке — есть ли хотя бы один контакт',
    act: async (page, vp) => {
      if (vp !== '1440') return;
      const row = page.locator('.career-vacancy-row').first();
      await row.getByRole('button', { name: /^Нетворкинг/ }).first().click();
    },
  });

  const result = await run.close();
  return { cjm: 'CJM5', title: 'Нетворкинг', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm5';
  const r = await runCjm5(outDir);
  console.log(JSON.stringify({ cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors }, null, 2));
}
