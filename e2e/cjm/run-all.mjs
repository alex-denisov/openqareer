#!/usr/bin/env node
// Прогон всего приёмочного стенда CJM 1–7 против прода. Один раз подтверждает
// сессию adenisov.test, переиспользует storageState на всю серию и пишет
// снимки и текстовые сводки в <outRoot>/cjmN/, и summary.json со списком шагов
// и ошибок консоли/страницы/сети для последующей ручной простановки баллов
// в scorecard/scorecard.md.
//
// Запуск:
//   node e2e/cjm/run-all.mjs docs/v1-release/audits/2026-09-23-cjm-run
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCjm1 } from './cjm1-first-login.mjs';
import { runCjm2 } from './cjm2-role-market.mjs';
import { runCjm3 } from './cjm3-daily-feed.mjs';
import { runCjm4 } from './cjm4-application.mjs';
import { runCjm5 } from './cjm5-networking.mjs';
import { runCjm6 } from './cjm6-post-application.mjs';
import { runCjm7 } from './cjm7-return-visit.mjs';
import { ensureSession, BASE_URL } from './lib/session.mjs';

const outRoot = process.argv[2] ?? './e2e/cjm/.state/run';
mkdirSync(outRoot, { recursive: true });
const expectedSha = 'c94d39ea5507cf51b0b85dd36d218adad4054dd3';

async function readHealth() {
  const response = await fetch(BASE_URL + '/health', { signal: AbortSignal.timeout(15_000) });
  return { status: response.status, sha: (await response.text()).trim() };
}

const healthBefore = await readHealth();
if (healthBefore.status !== 200 || healthBefore.sha !== expectedSha) {
  throw new Error(
    'C48 разрешает прогон только на production c94d39e; фактический /health не совпал',
  );
}

// Все шаги серии используют один и тот же кандидатский storageState.
const statePath = await ensureSession('owner');

const runners = [
  ['cjm1', runCjm1],
  ['cjm2', runCjm2],
  ['cjm3', runCjm3],
  ['cjm4', runCjm4],
  ['cjm5', runCjm5],
  ['cjm6', runCjm6],
  ['cjm7', runCjm7],
];

const summary = {
  runAt: new Date().toISOString(),
  base: BASE_URL,
  sessionRole: 'owner',
  healthBefore,
  cjms: [],
};

for (const [dir, runner] of runners) {
  const outDir = join(outRoot, dir);
  console.log(`\n=== ${dir} ===`);
  try {
    const result = await runner(outDir, statePath);
    summary.cjms.push({
      cjm: result.cjm,
      title: result.title,
      outDir,
      pitchMetrics: result.pitchMetrics ?? null,
      networkingAvailability: result.networkingAvailability ?? null,
      interviewAvailability: result.interviewAvailability ?? null,
      apiSnapshot: result.apiSnapshot ?? null,
      steps: result.steps.map((s) => ({
        name: s.name,
        note: s.note,
        shots: s.shots,
        urls: s.urls,
        harnessErrors: s.harnessErrors,
      })),
      runtimeErrors: result.runtimeErrors,
      harnessCancellations: result.harnessCancellations,
      top20Count: result.top20Count ?? null,
    });
  } catch (e) {
    console.error(`[${dir}] СБОЙ: ${e.message}`);
    summary.cjms.push({ cjm: dir, failed: true, error: e.message, outDir });
  }
}

summary.healthAfter = await readHealth();
const summaryPath = join(outRoot, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nсводка: ${summaryPath}`);
console.log(
  `production /health до/после: ${summary.healthBefore.sha} / ${summary.healthAfter.sha}`,
);
