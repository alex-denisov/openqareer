// CJM 6 — После отклика: статусы, напоминания, интервью, оффер.
// Открывает интервью-подготовку из вакансии и проверяет доску «Отклики».
// Внешнюю заявку и ручные отметки не создаёт.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm6(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm6', statePath, outDir);

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  const interviewAvailability = {};
  await run.step('interview-availability', {
    wait: 1500,
    note: 'Проверяем интервью CTA в деталях вакансии; заявка и отметка отклика не создаются',
    act: async (page) => {
      await page.locator('.vac-list-item').first().locator('.vac-row').click();
      await page.locator('.vacancies-detail-panel').waitFor({ state: 'visible' });
    },
  });
  for (const vp of ['1440', '390']) {
    interviewAvailability[vp] = await run.pages[vp]
      .locator('.vacancies-detail-panel')
      .getByRole('button', { name: /^Интервью/ })
      .count();
  }

  await run.step('responses-board', {
    wait: 3000,
    note: 'Трекер откликов и его пустое/сохранённое состояние',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Отклики', vp);
    },
  });

  const result = await run.close();
  return {
    cjm: 'CJM6',
    title: 'После отклика: статусы и интервью',
    interviewAvailability,
    ...result,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm6';
  const r = await runCjm6(outDir);
  console.log(
    JSON.stringify(
      {
        cjm: r.cjm,
        steps: r.steps.map((s) => s.name),
        interviewAvailability: r.interviewAvailability,
        runtimeErrors: r.runtimeErrors,
      },
      null,
      2,
    ),
  );
}
