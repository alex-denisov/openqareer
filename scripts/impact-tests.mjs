#!/usr/bin/env node
// Минимальный набор проверок по изменённым файлам (политика скорости пакетов, ACCEPTANCE-PROTOCOL §5).
//   node scripts/impact-tests.mjs [--base main] [--files a,b] [--unit] [--e2e] [--run]
// Без --run только печатает команды. Карта путей — e2e/impact-map.json.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Чистая часть: изменённые файлы + карта + список существующих спеков -> план. */
export function planImpact(files, map, existingSpecs) {
  const unitFiles = files.filter(
    (f) => /^(src|server|shared)\/.*\.(ts|tsx|mjs)$/u.test(f) && !/\.test\.[tj]sx?$/u.test(f),
  );
  const unitTests = files.filter((f) => /\.test\.[tj]sx?$/u.test(f));
  const specs = new Set();
  const notes = [];
  let both = false;
  let mobile = false;
  let matched = false;
  for (const f of files) {
    for (const rule of map.rules) {
      if (!f.startsWith(rule.prefix)) continue;
      matched = true;
      for (const s of rule.specs) specs.add(s);
      if (rule.projects === 'both') both = true;
      if (rule.note) notes.push(`${rule.prefix}: ${rule.note}`);
    }
    if (/^e2e\/[^/]+\.spec\.ts$/u.test(f)) {
      specs.add(path.basename(f, '.spec.ts'));
      matched = true;
    }
    if (/mobile|390/u.test(f)) mobile = true;
    if (f.startsWith('e2e/fixtures/')) {
      const base = path.basename(f, '.ts');
      for (const s of existingSpecs)
        if (fs.readFileSync(path.join(root, 'e2e', `${s}.spec.ts`), 'utf8').includes(base))
          specs.add(s);
    }
  }
  const projects = both
    ? ['desktop-1440', 'mobile-390']
    : mobile
      ? ['mobile-390']
      : ['desktop-1440'];
  const known = [...specs].filter((s) => existingSpecs.includes(s));
  const missing = [...specs].filter((s) => !existingSpecs.includes(s));
  const unmapped = files.filter(
    (f) => /^src\//u.test(f) && !map.rules.some((r) => f.startsWith(r.prefix)),
  );
  return {
    unitFiles,
    unitTests,
    specs: known,
    missingSpecs: missing,
    projects,
    unmapped,
    notes,
    matched,
  };
}

function changedFiles(base) {
  const git = (...a) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const committed = git('diff', '--name-only', `${base}...HEAD`);
  const working = git('diff', '--name-only');
  const untracked = git('ls-files', '--others', '--exclude-standard');
  return [...new Set([...committed, ...working, ...untracked])].filter(
    (f) => !f.startsWith('test-results/'),
  );
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const files = opt('--files') ? opt('--files').split(',') : changedFiles(opt('--base', 'main'));
  const map = JSON.parse(fs.readFileSync(path.join(root, 'e2e/impact-map.json'), 'utf8'));
  const existing = fs
    .readdirSync(path.join(root, 'e2e'))
    .filter((n) => n.endsWith('.spec.ts'))
    .map((n) => n.replace('.spec.ts', ''));
  const plan = planImpact(files, map, existing);
  const wantUnit = args.includes('--unit') || !args.includes('--e2e');
  const wantE2e = args.includes('--e2e') || !args.includes('--unit');
  const cmds = [];
  if (wantUnit) {
    const targets = [...new Set([...plan.unitFiles, ...plan.unitTests])];
    if (targets.length)
      cmds.push(['env', 'CI=1', './node_modules/.bin/vitest', 'run', '--related', ...targets]);
  }
  if (wantE2e && plan.specs.length) {
    for (const project of plan.projects) {
      cmds.push([
        'env',
        'CI=1',
        './node_modules/.bin/playwright',
        'test',
        ...plan.specs.map((s) => `e2e/${s}.spec.ts`),
        `--project=${project}`,
      ]);
    }
  }
  console.log(`изменено файлов: ${files.length}; проекты e2e: ${plan.projects.join(', ')}`);
  if (plan.unmapped.length)
    console.log(
      `НЕТ В КАРТЕ (добавьте префикс в e2e/impact-map.json): ${plan.unmapped.slice(0, 8).join(', ')}`,
    );
  if (plan.missingSpecs.length)
    console.log(`спеков из карты нет на диске: ${plan.missingSpecs.join(', ')}`);
  for (const n of plan.notes) console.log(`примечание: ${n}`);
  if (!cmds.length) {
    console.log('нечего запускать по этой карте');
    return;
  }
  for (const c of cmds) console.log(c.join(' '));
  if (args.includes('--run')) {
    for (const c of cmds) {
      const started = Date.now();
      const r = spawnSync(c[0], c.slice(1), { cwd: root, stdio: 'inherit' });
      console.log(
        `[${((Date.now() - started) / 1000).toFixed(0)} с] ${c.slice(0, 4).join(' ')} -> ${r.status}`,
      );
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
