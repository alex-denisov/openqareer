// CJM 7 — Возвращение: «с прошлого визита» — новые вакансии, сроки
// follow-up, изменения статусов. Заходит на главную дважды подряд (имитация
// возврата в той же сессии) и проверяет, отличается ли что-то во втором заходе.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm7(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm7', statePath, outDir);

  await run.gotoBoth('/app', 3000);
  await run.step('today-visit-1', { wait: 1500, note: 'Первый заход на «Сегодня» в этом прогоне' });
  await run.step('leave-today', {
    wait: 1000,
    note: 'Кандидат уходит на профиль между визитами',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Профиль', vp);
    },
  });
  await run.step('return-to-today', {
    wait: 1000,
    note: 'Возврат на «Сегодня» через основную навигацию без перезагрузки и отмены запросов',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Сегодня', vp);
    },
  });
  await run.step('today-visit-2', {
    wait: 1500,
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
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), runtimeErrors: r.runtimeErrors },
      null,
      2,
    ),
  );
}
