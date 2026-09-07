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

async function ask(path, { allowMissing = false } = {}) {
  const response = await fetch(`https://api.webmaster.yandex.net/v4${path}`, {
    headers: { Authorization: `OAuth ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (allowMissing) return { error: body?.error_code ?? `HTTP ${response.status}` };
    throw new Error(`${path} → HTTP ${response.status}`);
  }
  return body;
}

const { user_id: userId } = await ask('/user');
const { hosts } = await ask(`/user/${userId}/hosts`);
const host = hosts.find((item) => (item.ascii_host_url ?? '').includes(DOMAIN));
if (!host) {
  process.stdout.write(`${DOMAIN} не найден в аккаунте — сначала добавьте сайт в Вебмастере\n`);
  process.exit(2);
}
if (!host.verified) {
  process.stdout.write(`${DOMAIN}: права не подтверждены — замер невозможен\n`);
  process.exit(2);
}

const summary = await ask(`/user/${userId}/hosts/${host.host_id}/summary`, { allowMissing: true });
const today = new Date().toISOString().slice(0, 10);

// Свежеподтверждённый сайт Яндекс ещё не обошёл, и показателей у него нет.
// Это состояние, а не ошибка: писать в журнал нечего, и придумывать нечего.
if (summary.error === 'HOST_NOT_LOADED') {
  process.stdout.write(
    `Замер ${today}: Яндекс ещё не обошёл ${DOMAIN} (host_data_status NOT_LOADED).\n` +
      'Показателей нет — в журнал писать нечего. Обход начинается в первые дни\n' +
      'после подтверждения прав; повторить замер через несколько дней.\n',
  );
  process.exit(3);
}

process.stdout.write(`Замер ${today}, Яндекс.Вебмастер, ${DOMAIN}\n`);
process.stdout.write(`  ИКС: ${summary.sqi ?? 'нет данных'}\n`);
process.stdout.write(`  страниц в поиске: ${summary.searchable_pages_count ?? 'нет данных'}\n`);
process.stdout.write(`  исключено: ${summary.excluded_pages_count ?? 'нет данных'}\n`);
process.stdout.write(`  проблем сайта: ${JSON.stringify(summary.site_problems ?? {})}\n`);

process.stdout.write('\nСтрока для журнала:\n');
process.stdout.write(
  `| ${today} | страниц в поиске | ${summary.searchable_pages_count ?? '—'} | Яндекс.Вебмастер | |\n`,
);
