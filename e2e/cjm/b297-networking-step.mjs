// B297 — read-only разбор шага «Нетворкинг» на проде.
// Ничего не отправляет, согласие на поиск не выдаёт, контакты не обогащает.
// Только читает то, что кандидат реально видит после нажатия, и снимает кадр.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-b297';

export async function runB297(outdir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('b297-networking', statePath, outdir);

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  await run.step('vacancy-open', {
    wait: 6000,
    act: async (page) => {
      await page.locator('.vac-list-item').first().locator('.vac-row').click();
      await page.locator('.vacancies-detail-panel').waitFor({ state: 'visible' });
    },
  });

  const seen = {};
  for (const vp of ['1440', '390']) {
    const page = run.pages[vp];
    const trigger = page.getByRole('button', { name: 'Нетворкинг', exact: true });
    seen[vp] = { triggerCount: await trigger.count() };
    if (seen[vp].triggerCount === 0) continue;
    await trigger.first().click();
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(4000);
    seen[vp].dialogTitle = await dialog
      .locator('h2')
      .first()
      .innerText()
      .catch(() => null);
    seen[vp].lead = (await dialog.innerText()).slice(0, 700);
    seen[vp].buttons = await dialog.locator('button').allInnerTexts();
    seen[vp].tabs = await dialog.locator('[role="tab"]').allInnerTexts();
    seen[vp].contactCards = await dialog.locator('.career-outreach-list [role="button"]').count();
    seen[vp].emptyStates = await dialog
      .locator('.career-outreach-empty, .career-outreach-blank')
      .allInnerTexts()
      .catch(() => []);
  }

  const result = await run.close();
  return { packet: 'B297', seen, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runB297(outDir);
  console.log(
    JSON.stringify(
      { seen: r.seen, runtimeErrors: r.runtimeErrors, screenshots: r.screenshots },
      null,
      2,
    ),
  );
}
