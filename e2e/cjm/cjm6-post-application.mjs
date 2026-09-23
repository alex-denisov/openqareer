// CJM 6 — После отклика: статусы, напоминания, интервью, оффер.
// На момент прогона выделенного трекера ещё нет (B251) — скрипт проверяет,
// что реально есть сегодня: состояние «Откликнулся» в строке, интервью-модал,
// и признаки follow-up/воронки на главной или в поиске.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm6(outDir) {
  const statePath = await ensureSession('owner');
  const run = await openCjmRun('cjm6', statePath, outDir);

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

  await run.step('interview-open', {
    wait: 6000,
    note: 'Подготовка к интервью на первой строке — привязана ли к вакансии или общий шаблон',
    act: async (page, vp) => {
      if (vp !== '1440') return;
      const row = page.locator('.career-vacancy-row').first();
      await row
        .getByRole('button', { name: /^Интервью/ })
        .first()
        .click();
    },
  });

  await run.step('search-funnel', {
    wait: 4000,
    note: 'Воронка/этапы через шаг «Роль» индикатора пути — есть ли учёт статусов и follow-up',
    act: async (page) => {
      // «Поиск» has no rail item in the B248 IA; it opens from the path
      // indicator's «Роль» step, which every campaign screen carries.
      await page
        .getByRole('button', { name: /^Роль\./ })
        .first()
        .click();
    },
  });

  const result = await run.close();
  return { cjm: 'CJM6', title: 'После отклика: статусы и интервью', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm6';
  const r = await runCjm6(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors },
      null,
      2,
    ),
  );
}
