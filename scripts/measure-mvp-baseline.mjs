#!/usr/bin/env node
/**
 * Скрипт замера базовых значений продуктовых метрик MVP (B320).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   node scripts/measure-mvp-baseline.mjs --db /path/to/db.sqlite
 *   node scripts/measure-mvp-baseline.mjs --db /path/to/db.sqlite --since 2026-09-01 --exclude-test
 *
 * ЧТО ДЕЛАЕТ:
 * 1. Открывает SQLite исключительно в режиме чтения (readOnly: true).
 * 2. Рассчитывает продуктовые метрики (активация, время до первого отклика, возврат D7).
 * 3. Релевантность топ-20 выдаёт как null с ссылкой на scripts/measure-strict-top20.mjs.
 * 4. Печатает JSON в stdout и сохраняет в output/mvp-baseline-<дата>.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMvpBaseline } from './mvpBaseline.mjs';

/**
 * Извлекает строковое значение аргумента командной строки вида --key value или --key=value.
 * @param {readonly string[]} args
 * @param {string} name
 * @returns {string | null}
 */
export function getCliStringArg(args, name) {
  for (let i = 0; i < args.length; i++) {
    const item = args[i];
    if (item === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (item.startsWith(`--${name}=`)) {
      return item.slice(name.length + 3);
    }
  }
  return null;
}

/**
 * Проверяет наличие флага командной строки.
 * @param {readonly string[]} args
 * @param {string} name
 * @returns {boolean}
 */
export function hasCliFlag(args, name) {
  return args.includes(`--${name}`);
}

/**
 * Разбирает параметры командной строки.
 * @param {readonly string[]} args
 */
export function parseArgs(args) {
  const db = getCliStringArg(args, 'db');
  const since = getCliStringArg(args, 'since');
  const excludeTest = hasCliFlag(args, 'exclude-test');
  const output = getCliStringArg(args, 'output');

  return {
    db,
    since,
    excludeTest,
    output,
  };
}

/**
 * Определяет путь для записи итогового JSON-файла.
 * @param {string | null} customOutput
 * @param {string} capturedAt
 * @returns {string}
 */
export function resolveOutputPath(customOutput, capturedAt) {
  if (customOutput) return resolve(customOutput);
  const dateStr = capturedAt.slice(0, 10);
  const outputDir = resolve(fileURLToPath(import.meta.url), '../../output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return resolve(outputDir, `mvp-baseline-${dateStr}.json`);
}

/**
 * Главная точка выполнения CLI.
 */
export async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.db) {
    console.error('Ошибка: не указан обязательный параметр --db <путь к базе SQLite>');
    console.error('Использование: node scripts/measure-mvp-baseline.mjs --db <путь> [--since YYYY-MM-DD] [--exclude-test]');
    process.exit(1);
  }

  const resolvedDbPath = resolve(args.db);
  if (!existsSync(resolvedDbPath)) {
    console.error(`Ошибка: файл базы данных не найден: ${resolvedDbPath}`);
    process.exit(1);
  }

  const db = new DatabaseSync(resolvedDbPath, { readOnly: true });
  try {
    const capturedAt = new Date().toISOString();
    const baseline = computeMvpBaseline(db, {
      since: args.since,
      excludeTest: args.excludeTest,
      capturedAt,
    });

    const jsonText = JSON.stringify(baseline, null, 2);
    console.log(jsonText);

    const outputFile = resolveOutputPath(args.output, capturedAt);
    writeFileSync(outputFile, jsonText, 'utf8');
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('Ошибка замера базовых метрик:', err.message);
    process.exit(1);
  });
}
