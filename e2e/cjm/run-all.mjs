#!/usr/bin/env node
// Прогон всего приёмочного стенда CJM 1–7 против прода. Логинится по одному
// разу на роль (owner, qa-candidate), переиспользует storageState, пишет
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

const outRoot = process.argv[2] ?? './e2e/cjm/.state/run';
mkdirSync(outRoot, { recursive: true });

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
  base: process.env.OPENQAREER_CJM_BASE ?? 'https://openqareer.com',
  cjms: [],
};

for (const [dir, runner] of runners) {
  const outDir = join(outRoot, dir);
  console.log(`\n=== ${dir} ===`);
  try {
    const result = await runner(outDir);
    summary.cjms.push({
      cjm: result.cjm,
      title: result.title,
      outDir,
      steps: result.steps.map((s) => ({
        name: s.name,
        note: s.note,
        shots: s.shots,
        errors: s.errors,
      })),
      consoleErrors: result.consoleErrors,
      top20Count: result.top20Count ?? null,
    });
  } catch (e) {
    console.error(`[${dir}] СБОЙ: ${e.message}`);
    summary.cjms.push({ cjm: dir, failed: true, error: e.message, outDir });
  }
}

const summaryPath = join(outRoot, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nсводка: ${summaryPath}`);
