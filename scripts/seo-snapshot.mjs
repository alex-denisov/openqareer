#!/usr/bin/env node
/**
 * Недельный замер показателей поиска (B209).
 *
 * Печатает строку, готовую для `docs/v1-release/seo/JOURNAL.md`: цифра, дата и
 * инструмент, которым она снята. Правило журнала — цифра без источника туда не
 * пишется, поэтому источник печатает сам скрипт.
 *
 * Токен читается из `~/.openqareer/openqareer.env` самим скриптом и в вывод не
 * попадает — тот же приём, что в `signed-in-walk.mjs`.
 *
 * Запуск: node scripts/seo-snapshot.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');
const DOMAIN = 'openqareer.com';

function readEnvironment(file) {
  if (!existsSync(file)) throw new Error(`нет файла с учётными данными: ${file}`);
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const environment = readEnvironment(ENV_FILE);
const token = environment.YANDEX_WEBMASTER_TOKEN || environment.YANDEX_OAUTH_TOKEN;
if (!token) {
  process.stdout.write(`в ${ENV_FILE} нет токена Яндекса — замер невозможен\n`);
  process.exit(1);
}

const { collectYandexWebmaster } = await import('./yandex-webmaster-client.mjs');
const { mkdirSync, writeFileSync, chmodSync } = await import('node:fs');
const snapshot = await collectYandexWebmaster(token);
const today = new Date().toISOString().slice(0, 10);
const directory = process.env.YANDEX_SEO_SNAPSHOT_DIR ?? join(process.cwd(), 'docs/v1-release/seo/yandex-snapshots');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const path = join(directory, `${today}.json`);
writeFileSync(path, JSON.stringify({ ...snapshot, mode: 'official_api', observedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
chmodSync(path, 0o600);
const summary = snapshot.summary;
process.stdout.write(`Замер ${today}, Яндекс.Вебмастер, ${DOMAIN}\n`);
if (summary?.status === 'available') {
  process.stdout.write(`  ИКС: ${summary.sqi ?? 'нет данных'}\n`);
  process.stdout.write(`  страниц в поиске: ${summary.indexedPages ?? 'нет данных'}\n`);
} else process.stdout.write(`  показатели недоступны: ${summary?.reason ?? snapshot.reason ?? 'unknown'}\n`);
process.stdout.write(`  snapshot: ${path}\n`);
