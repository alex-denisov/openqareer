// CJM 2 — Роль и рынок: выбрать 1–3 роли и географию → кампания.
// Учётка: adenisov.test (OPENQAREER_OWNER_TEST_*) — полный профиль LinkedIn.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm2(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm2', statePath, outDir);

  await run.gotoBoth('/app', 6000);

  await run.step('search-open', {
    wait: 3000,
    note: 'Шаг «Роль» индикатора пути — кампания и предложенные роли',
    act: async (page) => {
      // «Поиск» has no rail item in the B248 IA; it opens from the path
      // indicator's «Роль» step, which every campaign screen carries.
      const btn = page.getByRole('button', { name: /^Роль\./ }).first();
      await btn.click();
    },
  });

  await run.step('search-roles', {
    wait: 5000,
    note: 'Блок «Роли и рынок» — совпадает ли кампания с предложенными ролями и профилем',
  });

  const result = await run.close();
  return { cjm: 'CJM2', title: 'Роль и рынок → кампания', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm2';
  const r = await runCjm2(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors },
      null,
      2,
    ),
  );
}
