// CJM 4 — Отклик: письмо и версия резюме → переход → фиксация.
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm4(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm4', statePath, outDir);
  const pitchMetrics = {};

  await run.gotoBoth('/app', 6000);
  await run.step('vacancies-open', {
    wait: 8000,
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  await run.step('application-letter', {
    wait: 1000,
    note: 'Генератор письма для первой вакансии; фиксируются запрос и итог без отправки отклика',
    act: async (page, vp) => {
      const started = Date.now();
      const responsePromise = page
        .waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith('/pitch') &&
            response.request().method() === 'POST',
          { timeout: 120_000 },
        )
        .catch(() => null);
      const row = page.locator('.vac-list-item').first();
      await row.locator('.vac-row').click();
      const detail = page.getByRole('complementary', { name: 'Карточка вакансии' });
      await detail.getByRole('button', { name: 'Сопроводительное письмо', exact: true }).click();
      const response = await responsePromise;
      pitchMetrics[vp] = {
        status: response?.status() ?? null,
        elapsedMs: Date.now() - started,
      };
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
    },
  });

  await run.step('letter-ready', {
    wait: 2000,
    note: 'Текст/состояние ошибки показаны в генераторе; проверяем возможность закрыть диалог',
  });

  const result = await run.close();
  return { cjm: 'CJM4', title: 'Подготовка письма без отправки отклика', pitchMetrics, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm4';
  const r = await runCjm4(outDir);
  console.log(
    JSON.stringify(
      {
        cjm: r.cjm,
        steps: r.steps.map((s) => s.name),
        pitchMetrics: r.pitchMetrics,
        runtimeErrors: r.runtimeErrors,
      },
      null,
      2,
    ),
  );
}
