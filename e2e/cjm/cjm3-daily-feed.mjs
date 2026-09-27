// CJM 3 — Ежедневная подборка → решение по вакансии.
// Извлекает топ-20 строк списка «Вакансии» (заголовок + видимый текст
// строки) в data/top20.json — сырьё для ручной разметки релевантности
// (см. scorecard/relevance-template.md). Учётка: adenisov.test.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCjmRun } from './lib/capture.mjs';
import { ensureSession } from './lib/session.mjs';
import { clickCabinetSection } from './lib/navigation.mjs';

export async function runCjm3(outDir, sharedStatePath) {
  const statePath = sharedStatePath ?? (await ensureSession('owner'));
  const run = await openCjmRun('cjm3', statePath, outDir);

  await run.gotoBoth('/app', 6000);

  await run.step('vacancies-open', {
    wait: 8000,
    note: 'Раздел «Вакансии» — список подборки',
    act: async (page, vp) => {
      await clickCabinetSection(page, 'Вакансии', vp);
    },
  });

  // Топ-20 строк на широкой ширине — источник ручной разметки релевантности.
  const page1440 = run.pages['1440'];
  const apiSnapshot = await page1440.evaluate(async () => {
    async function read(path) {
      const startedAt = performance.now();
      try {
        const response = await fetch(path, { credentials: 'include' });
        const body = await response.json();
        return {
          status: response.status,
          elapsedMs: Math.round(performance.now() - startedAt),
          body,
        };
      } catch {
        return { status: null, elapsedMs: Math.round(performance.now() - startedAt), body: null };
      }
    }
    const [campaign, firstMatched, today] = await Promise.all([
      read('/api/v1/candidate/campaign'),
      read('/api/v1/candidate/matched-vacancies'),
      read('/api/v1/candidate/today?tz=Europe%2FMoscow'),
    ]);
    const matchedItems = [...(firstMatched.body?.data ?? [])];
    const pageMs = [firstMatched.elapsedMs];
    let nextOffset = firstMatched.body?.meta?.nextOffset ?? null;
    while (matchedItems.length < 20 && nextOffset !== null) {
      const nextPage = await read(
        '/api/v1/candidate/matched-vacancies?offset=' + encodeURIComponent(nextOffset),
      );
      matchedItems.push(...(nextPage.body?.data ?? []));
      pageMs.push(nextPage.elapsedMs);
      nextOffset = nextPage.body?.meta?.nextOffset ?? null;
    }
    const rows = matchedItems.slice(0, 20).map((item) => {
      const explanation = item.explanation ?? {};
      return {
        title: item.cluster?.canonicalTitle ?? '',
        location: item.cluster?.canonicalLocation ?? '',
        remote: Boolean(item.cluster?.isRemote),
        roleMatch: explanation.roleMatch ?? null,
        levelMatch: explanation.levelMatch ?? null,
        matchingCount: explanation.matchingCount ?? explanation.matchingPoints?.length ?? null,
        missingCount: explanation.missingCount ?? explanation.missingPoints?.length ?? null,
      };
    });
    return {
      capturedAt: new Date().toISOString(),
      campaign: {
        status: campaign.status,
        elapsedMs: campaign.elapsedMs,
        roles: campaign.body?.data?.roles ?? null,
        regions: campaign.body?.data?.regions ?? null,
      },
      matched: {
        status: firstMatched.status,
        elapsedMs: firstMatched.elapsedMs,
        pageMs,
        total: firstMatched.body?.meta?.total ?? null,
        rows,
      },
      today: {
        status: today.status,
        elapsedMs: today.elapsedMs,
        vacanciesPending: today.body?.data?.vacanciesPending ?? null,
        queueCount: today.body?.data?.queue?.length ?? null,
      },
    };
  });
  writeFileSync(
    join(outDir, 'top20-api-detail.json'),
    JSON.stringify(
      {
        capturedAt: apiSnapshot.capturedAt,
        status: apiSnapshot.matched.status,
        total: apiSnapshot.matched.total,
        firstPageMs: apiSnapshot.matched.elapsedMs,
        rows: apiSnapshot.matched.rows,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(outDir, '..', 'api-snapshot.json'), JSON.stringify(apiSnapshot, null, 2));
  const rows = await page1440
    .locator('.vac-list-item')
    .evaluateAll((els) =>
      els.slice(0, 20).map((el, i) => ({
        index: i + 1,
        title: el.querySelector('.vac-title')?.textContent?.trim() ?? '',
        text: el.textContent?.trim().slice(0, 300) ?? '',
      })),
    )
    .catch(() => []);
  writeFileSync(join(outDir, 'top20.json'), JSON.stringify(rows, null, 2));
  console.log(`[cjm3] извлечено строк топ-20: ${rows.length}`);

  await run.step('vacancy-selected', {
    wait: 3000,
    note: 'Выбор строки открывает детали; это локальное состояние без сохранения решения',
    act: async (page) => {
      await page.locator('.vac-list-item').first().locator('.vac-row').click();
    },
  });

  await run.step('vacancy-actions', {
    wait: 2000,
    note: 'Действия для выбранной вакансии проверяются без отметки отклика и внешнего перехода',
  });

  const result = await run.close();
  return {
    cjm: 'CJM3',
    title: 'Ежедневная подборка и решение',
    top20Count: rows.length,
    apiSnapshot: {
      campaignStatus: apiSnapshot.campaign.status,
      matchedStatus: apiSnapshot.matched.status,
      matchedTotal: apiSnapshot.matched.total,
      matchedTop20Count: apiSnapshot.matched.rows.length,
      matchedFirstPageMs: apiSnapshot.matched.elapsedMs,
      matchedPageMs: apiSnapshot.matched.pageMs,
      todayStatus: apiSnapshot.today.status,
      todayElapsedMs: apiSnapshot.today.elapsedMs,
      capturedAt: apiSnapshot.capturedAt,
    },
    ...result,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? './e2e/cjm/.state/tmp-cjm3';
  const r = await runCjm3(outDir);
  console.log(
    JSON.stringify(
      {
        cjm: r.cjm,
        steps: r.steps.map((s) => s.name),
        top20Count: r.top20Count,
        apiSnapshot: r.apiSnapshot,
        runtimeErrors: r.runtimeErrors,
      },
      null,
      2,
    ),
  );
}
