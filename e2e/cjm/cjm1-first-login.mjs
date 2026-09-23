// CJM 1 — Первый вход: регистрация → импорт (PDF/LinkedIn/hh) → профиль.
// Учётка: QA-кандидат (OPENQAREER_QA_CANDIDATE_*) — фиксированный тестовый
// аккаунт первого входа, per поручению CPO (не создаём нового кандидата на
// каждый прогон — вход ограничен по частоте).
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';

export async function runCjm1(outDir) {
  const statePath = await ensureSession('qa-candidate');
  const run = await openCjmRun('cjm1', statePath, outDir);

  await run.gotoBoth('/app', 7000);
  await run.step('home', { wait: 2000, note: 'Главная сразу после входа — что видит кандидат первым' });

  await run.step('profile-check', {
    wait: 2000,
    note: 'Раскрыты складки профиля/подтверждение (если есть кнопка «Проверить факты»)',
    act: async (page) => {
      const btn = page.getByRole('button', { name: /Проверить факты/ }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click();
    },
  });

  for (const tab of ['О себе', 'Навыки', 'Документы', 'Вы в поиске']) {
    await run.step(`profile-tab-${tab}`, {
      wait: 1500,
      act: async (page) => {
        const t = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab, exact: true })).first();
        if (await t.isVisible().catch(() => false)) await t.click();
        else throw new Error(`вкладка «${tab}» не найдена`);
      },
    });
  }

  const result = await run.close();
  return { cjm: 'CJM1', title: 'Первый вход и импорт', ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm1';
  const r = await runCjm1(outDir);
  console.log(JSON.stringify({ cjm: r.cjm, steps: r.steps.map((s) => s.name), consoleErrors: r.consoleErrors }, null, 2));
}
