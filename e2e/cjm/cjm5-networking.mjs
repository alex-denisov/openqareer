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
  const networkingStep = {};
  for (const vp of ['1440', '390']) {
    const page = run.pages[vp];
    const trigger = page.getByRole('button', { name: 'Нетворкинг', exact: true });
    networkingAvailability[vp] = await trigger.count();
    if (networkingAvailability[vp] === 0) {
      networkingStep[vp] = { opened: false, reason: 'кнопки нет в детали вакансии' };
      continue;
    }
    await trigger.first().click();
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(4000);
    networkingStep[vp] = {
      opened: true,
      title: await dialog
        .locator('h2')
        .first()
        .innerText()
        .catch(() => null),
      contactCategories: await dialog.locator('[role="tab"]').allInnerTexts(),
      contactCount: await dialog.locator('.career-outreach-list [role="button"]').count(),
      canCopy: await dialog.getByRole('button', { name: /Скопировать текст/u }).count(),
      // Сам продукт ничего не отправляет: закрываем окно, ничего не нажимая.
      closedBy: await dialog
        .getByRole('button', { name: /Закрыть|Отмена/u })
        .first()
        .click()
        .then(() => 'кнопка закрытия')
        .catch(() => 'Esc или клик вне окна'),
    };
  }
  const result = await run.close();
  return { cjm: 'CJM5', title: 'Нетворкинг', networkingAvailability, networkingStep, ...result };
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
        networkingStep: r.networkingStep,
        runtimeErrors: r.runtimeErrors,
      },
      null,
      2,
    ),
  );
}
