// CJM 7 — Возвращение: «с прошлого визита» — новые вакансии, сроки
// follow-up, изменения статусов. Заходит на главную дважды подряд (имитация
// возврата в той же сессии) и проверяет, отличается ли что-то во втором заходе.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm7(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm7', statePath, outDir);

  await run.gotoBoth('/app', 6000);
  await run.step('home-visit-1', { wait: 2000, note: 'Первый заход на главную в этом прогоне' });

  await run.gotoBoth('/app', 5000);
  await run.step('home-visit-2', {
    wait: 2000,
    note: 'Повторный заход — есть ли «с прошлого визита», новые вакансии, сроки follow-up',
  });

  const result = await run.close();
  return { cjm: 'CJM7', title: 'Возвращение', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm7';
  const r = await runCjm7(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors },
      null,
      2,
    ),
  );
}
