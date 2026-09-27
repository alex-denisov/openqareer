// CJM 5 — Нетворкинг: кто в компании → сообщение → учёт.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm5(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm5', statePath, outDir);

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  await run.step('networking-open', {
    wait: 8000,
    note: 'Деталь вакансии показывает доступ к рекрутеру; согласие и внешний поиск не запускаются',
    act: async (page) => {
      await page.locator('.vac-list-item').first().locator('.vac-row').click();
      await page.locator('.vacancies-detail-panel').waitFor({ state: 'visible' });
    },
  });

  const networkingAvailability = {};
  for (const vp of ['1440', '390']) {
    networkingAvailability[vp] = await run.pages[vp]
      .getByRole('button', { name: 'Нетворкинг', exact: true })
      .count();
  }
  const result = await run.close();
  return { cjm: 'CJM5', title: 'Нетворкинг', networkingAvailability, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm5';
  const r = await runCjm5(outDir);
  console.log(
    JSON.stringify(
      {
        cjm: r.cjm,
        steps: r.steps.map((s) => s.name),
        networkingAvailability: r.networkingAvailability,
        runtimeErrors: r.runtimeErrors,
      },
      null,
      2,
    ),
  );
}
