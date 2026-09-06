#!/usr/bin/env node
/**
 * Проверка доступа к API Яндекса без раскрытия токена (B209).
 *
 * Скрипт сам читает `~/.openqareer/openqareer.env` и печатает только исход:
 * ни токен, ни его часть в вывод не попадают и через контекст агента не
 * проходят. Это тот же приём, что в `signed-in-walk.mjs`.
 *
 * Запуск: node scripts/verify-yandex-access.mjs
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
  process.stdout.write(
    `в ${ENV_FILE} нет ни YANDEX_WEBMASTER_TOKEN, ни YANDEX_OAUTH_TOKEN — проверять нечего\n`,
  );
  process.exit(1);
}

async function ask(url) {
  const response = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
  const body = await response.text();
  return { status: response.status, body };
}

const user = await ask('https://api.webmaster.yandex.net/v4/user');
if (user.status !== 200) {
  process.stdout.write(
    `Вебмастер отказал: HTTP ${user.status}. ` +
      `Вероятная причина — у токена нет права на Вебмастер (это отдельная область доступа).\n`,
  );
  process.exit(1);
}

const userId = JSON.parse(user.body).user_id;
process.stdout.write(`Вебмастер: доступ есть, user_id ${userId}\n`);

const hosts = await ask(`https://api.webmaster.yandex.net/v4/user/${userId}/hosts`);
if (hosts.status !== 200) {
  process.stdout.write(`список сайтов недоступен: HTTP ${hosts.status}\n`);
  process.exit(1);
}

const list = JSON.parse(hosts.body).hosts ?? [];
process.stdout.write(`сайтов в аккаунте: ${list.length}\n`);
for (const host of list) {
  process.stdout.write(`  ${host.ascii_host_url} — проверка прав: ${host.verified ? 'да' : 'НЕТ'}\n`);
}

const ours = list.find((host) => (host.ascii_host_url ?? '').includes(DOMAIN));
if (!ours) {
  process.stdout.write(
    `\n${DOMAIN} в этом аккаунте не добавлен. Добавьте сайт в Вебмастере и подтвердите права —\n` +
      `после этого замеры позиций можно снимать этим же токеном.\n`,
  );
  process.exit(2);
}
if (!ours.verified) {
  process.stdout.write(`\n${DOMAIN} добавлен, но права не подтверждены.\n`);
  process.exit(2);
}
process.stdout.write(`\n${DOMAIN}: права подтверждены, host_id ${ours.host_id}\n`);
