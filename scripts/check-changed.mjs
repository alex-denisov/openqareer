#!/usr/bin/env node
// Быстрая локальная проверка по изменениям относительно origin/main.
//   npm run check:changed [-- --base origin/main] [--no-e2e] [--dry]
// Порядок: eslint (кэш) + prettier (кэш) + tsc (инкрементально) параллельно,
// затем затронутые unit-тесты (vitest related), затем затронутые e2e-спеки
// по e2e/impact-map.json (сборка без tsc — типы уже проверены шагом выше).
// CI остаётся строгим: полный lint, tsc, все тесты и `npm run build` с tsc.
// CHECK_E2E=0 пропускает e2e (так же, как --no-e2e).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planImpact } from './impact-tests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', name);
const LINTABLE = /\.(ts|tsx|js|mjs|cjs|jsx)$/u;
const TYPED = /^(src|server|shared)\/.*\.(ts|tsx)$/u;
const BUILD_INPUT = /^(src|shared|public|index\.html|vite\.config\.ts|scripts\/prerender)/u;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

function defaultBase() {
  try {
    git('rev-parse', '--verify', '--quiet', 'origin/main');
    return 'origin/main';
  } catch {
    return 'main';
  }
}

/** Изменённые файлы: коммиты ветки после merge-base, рабочее дерево и новые файлы. */
export function changedFiles(base) {
  const all = [
    ...git('diff', '--name-only', '--diff-filter=d', `${base}...HEAD`),
    ...git('diff', '--name-only', '--diff-filter=d', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard'),
  ];
  return [...new Set(all)].filter((f) => fs.existsSync(path.join(root, f)));
}

/** Чистая часть: какие шаги нужны для набора файлов. */
export function planChecks(files, impact, prettierTargets) {
  const lintFiles = files.filter((f) => LINTABLE.test(f) && !f.startsWith('.claude/'));
  const formatFiles = files.filter((f) =>
    prettierTargets.some((t) => f === t || f.startsWith(`${t}/`)),
  );
  const unitTargets = [...new Set([...impact.unitFiles, ...impact.unitTests])];
  return {
    lintFiles,
    formatFiles,
    typecheck: files.some((f) => TYPED.test(f) || f === 'tsconfig.json'),
    unitTargets,
    specs: impact.specs,
    projects: impact.projects,
    needsBuild: impact.specs.length > 0 && files.some((f) => BUILD_INPUT.test(f)),
  };
}

function prettierTargetsFromPackage() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.scripts['format:check'].split(/\s+/u).slice(2);
}

function run(label, cmd, args, env = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('close', (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[check:changed] ${label}: ${code === 0 ? 'ok' : `код ${code}`} за ${secs} с`);
      resolve({ label, code: code ?? 1 });
    });
  });
}

function staticSteps(plan) {
  const steps = [];
  if (plan.lintFiles.length)
    steps.push([
      'eslint',
      bin('eslint'),
      [
        '--cache',
        '--cache-location',
        'node_modules/.cache/eslint/',
        '--max-warnings=0',
        '--no-warn-ignored',
        ...plan.lintFiles,
      ],
    ]);
  if (plan.formatFiles.length)
    steps.push(['prettier', bin('prettier'), ['--cache', '--check', ...plan.formatFiles]]);
  if (plan.typecheck)
    steps.push([
      'tsc',
      bin('tsc'),
      [
        '--noEmit',
        '--incremental',
        '--tsBuildInfoFile',
        'node_modules/.cache/tsc/tsconfig.tsbuildinfo',
      ],
    ]);
  return steps;
}

function e2eSteps(plan) {
  if (!plan.specs.length) return [];
  const steps = [];
  if (plan.needsBuild || !fs.existsSync(path.join(root, 'dist', 'index.html')))
    steps.push(['build:fast', 'npm', ['run', 'build:fast']]);
  const specs = plan.specs.map((s) => `e2e/${s}.spec.ts`);
  for (const project of plan.projects)
    steps.push([`e2e ${project}`, bin('playwright'), ['test', ...specs, `--project=${project}`]]);
  return steps;
}

async function runSequential(steps) {
  for (const [label, cmd, args] of steps) {
    const r = await run(label, cmd, args);
    if (r.code !== 0) return r.code;
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--base');
  const base = i >= 0 ? args[i + 1] : defaultBase();
  const withE2e = !args.includes('--no-e2e') && process.env.CHECK_E2E !== '0';
  const files = changedFiles(base);
  const map = JSON.parse(fs.readFileSync(path.join(root, 'e2e/impact-map.json'), 'utf8'));
  const existing = fs
    .readdirSync(path.join(root, 'e2e'))
    .filter((n) => n.endsWith('.spec.ts'))
    .map((n) => n.replace('.spec.ts', ''));
  const plan = planChecks(files, planImpact(files, map, existing), prettierTargetsFromPackage());
  console.log(
    `[check:changed] база ${base}: файлов ${files.length}, lint ${plan.lintFiles.length}, ` +
      `типы ${plan.typecheck ? 'да' : 'нет'}, unit-целей ${plan.unitTargets.length}, ` +
      `e2e ${withE2e ? plan.specs.join(', ') || '—' : 'выключены'}`,
  );
  if (args.includes('--dry')) return 0;

  const results = await Promise.all(staticSteps(plan).map(([l, c, a]) => run(l, c, a)));
  const failed = results.find((r) => r.code !== 0);
  if (failed) return failed.code;
  if (plan.unitTargets.length) {
    const r = await run('unit', bin('vitest'), [
      'related',
      ...plan.unitTargets,
      '--run',
      '--passWithNoTests',
    ]);
    if (r.code !== 0) return r.code;
  }
  return withE2e ? runSequential(e2eSteps(plan)) : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
