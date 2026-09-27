// CJM 1 — Профиль и документы существующего кандидата.
// C48 использует adenisov.test для всех семи CJM; этот сценарий не изображает
// первый вход или чистый онбординг.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm1(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm1', statePath, outDir);

  await run.gotoBoth('/app', 7000);
  await run.step('today', {
    wait: 2000,
    note: 'Существующий профиль adenisov.test; экран «Сегодня» после входа',
  });

  await run.step('profile-screen', {
    wait: 3000,
    note: 'Профиль через актуальную навигацию; фиксируем сохранённые разделы без редактирования',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Профиль', vp);
    },
  });

  await run.step('documents', {
    wait: 2000,
    note: 'Актуальная вкладка «Документ и форматы» на экране профиля',
    act: async (page) => {
      await page
        .getByRole('group', { name: 'Что показать' })
        .getByRole('button', { name: 'Документ и форматы', exact: true })
        .click();
      await page
        .locator('.career-profile-screen-view')
        .getByRole('button', { name: 'Документ и форматы', exact: true })
        .click();
      await page.locator('.career-profile-screen-document-menu').waitFor({ state: 'visible' });
    },
  });

  await run.step('source-audit', {
    wait: 3000,
    note: 'Проверка фактов по источникам; переход read-only',
    act: async (page) => {
      await page
        .getByRole('group', { name: 'Что показать' })
        .getByRole('button', { name: 'Проверка по источникам', exact: true })
        .click();
    },
  });

  const result = await run.close();
  return { cjm: 'CJM1', title: 'Профиль и документы существующего кандидата', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm1';
  const r = await runCjm1(outDir);
  console.log(
    JSON.stringify(
      { cjm: r.cjm, steps: r.steps.map((s) => s.name), runtimeErrors: r.runtimeErrors },
      null,
      2,
    ),
  );
}
