#!/usr/bin/env node
/**
 * Скрипт приёмки сборки воркера обслуживания (B323).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   node scripts/accept-maintenance-import.mjs
 *   node scripts/accept-maintenance-import.mjs --no-build
 *
 * ЧТО ДЕЛАЕТ:
 * 1. Запускает `npm run build:server` (если не указан флаг --no-build).
 * 2. Копирует `dist/` в пустой временный каталог БЕЗ `node_modules`.
 * 3. Делает `import()` `dist/maintenance.mjs` в изолированном процессе Node.js
 *    с выключенными флагами исполнителей и тестовой конфигурацией.
 * 4. Возвращает код 0, если импорт прошел без ошибок разрешения модулей,
 *    или код 1 при ошибке (с выводом ошибки).
 * 5. Гарантированно удаляет временный каталог при завершении.
 */
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function runServerBuild(cwd = process.cwd()) {
  const result = spawnSync('npm', ['run', 'build:server'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`npm run build:server failed with exit code ${result.status}`);
  }
}

function buildChildEnv(overrides = {}) {
  return {
    ...process.env,
    OPENQAREER_PREVIEW_API_TOKEN:
      process.env.OPENQAREER_PREVIEW_API_TOKEN ?? '01234567890123456789012345678901',
    OPENQAREER_DATA_ENCRYPTION_KEY:
      process.env.OPENQAREER_DATA_ENCRYPTION_KEY ??
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    OPENQAREER_OPENAI_API_KEY:
      process.env.OPENQAREER_OPENAI_API_KEY ?? 'sk-mock-key-for-acceptance-test-12345',
    OPENQAREER_OPENROUTER_API_KEY:
      process.env.OPENQAREER_OPENROUTER_API_KEY ?? 'sk-or-mock-key-for-acceptance-test-12345',
    OPENQAREER_LINKEDIN_POOL_EXECUTOR_ENABLED: 'false',
    OPENQAREER_DATABASE_PATH: ':memory:',
    ...overrides,
  };
}

function spawnImportRunner(tmpRoot, entryUrl, env, timeoutMs = 15_000) {
  const runnerCode = `
    try {
      await import(${JSON.stringify(entryUrl)});
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  `;
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', runnerCode], {
      cwd: tmpRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (c) => { output += c.toString(); });
    child.stderr.on('data', (c) => { output += c.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise({ exitCode: 124, output });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 1, output: output.trim() });
    });
  });
}

export async function testMaintenanceImport(distSourcePath, options = {}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'oq-accept-maint-'));
  const tmpDist = join(tmpRoot, 'dist');

  try {
    if (!existsSync(distSourcePath)) {
      return { success: false, code: 1, output: '', error: `Каталог не найден: ${distSourcePath}` };
    }
    cpSync(distSourcePath, tmpDist, { recursive: true });
    const entryFile = join(tmpDist, options.entryFile ?? 'maintenance.mjs');
    const entryUrl = pathToFileURL(entryFile).href;
    const childEnv = buildChildEnv(options.env);

    const { exitCode, output } = await spawnImportRunner(tmpRoot, entryUrl, childEnv, options.timeoutMs);
    return {
      success: exitCode === 0,
      code: exitCode,
      output,
      error: exitCode !== 0 ? output : undefined,
    };
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

export async function main() {
  const skipBuild = process.argv.includes('--no-build');
  const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');

  if (!skipBuild) {
    console.log('Сборка сервера: npm run build:server...');
    runServerBuild(projectRoot);
  }

  const distDir = join(projectRoot, 'dist');
  console.log(`Проверка импорта dist/maintenance.mjs в изолированном каталоге без node_modules...`);

  const result = await testMaintenanceImport(distDir);
  if (result.success) {
    console.log('OK: импорт dist/maintenance.mjs успешно выполнен без node_modules (код 0).');
    process.exit(0);
  } else {
    console.error(`FAIL: ошибка импорта dist/maintenance.mjs (код ${result.code}):`);
    console.error(result.error);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('Непредвиденная ошибка:', err);
    process.exit(1);
  });
}
