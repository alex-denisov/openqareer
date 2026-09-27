// CJM 2 — Роль и рынок: проверить роли, географию и рынок кампании.
// Учётка: adenisov.test (OPENQAREER_OWNER_TEST_*) — полный профиль LinkedIn.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm2(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm2', statePath, outDir);

  await run.gotoBoth('/app', 6000);

  await run.step('search-open', {
    wait: 3000,
    note: 'Кампания открывается через актуальную навигацию «Вакансии»',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  await run.step('search-roles', {
    wait: 5000,
    note: 'Актуальный экран кампании показывает список и фильтры ролей/географии',
    act: async (page, vp) => {
      if (vp === '390') {
        await page
          .getByRole('button', { name: 'Фильтры и сохранённые запросы', exact: true })
          .click();
      }
    },
  });

  const result = await run.close();
  return { cjm: 'CJM2', title: 'Роль и рынок → кампания', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm2';
  const r = await runCjm2(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), runtimeErrors: r.runtimeErrors },
      null,
      2,
    ),
  );
}
