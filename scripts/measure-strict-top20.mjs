#!/usr/bin/env node
/**
 * Замер строгого топ-20 подборки кандидата adenisov.test (B323).
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 *   node scripts/measure-strict-top20.mjs                     # прод по умолчанию
 *   node scripts/measure-strict-top20.mjs --base http://127.0.0.1:3210
 *   node scripts/measure-strict-top20.mjs --env ~/.openqareer/openqareer.env
 *
 * ЧТО ДЕЛАЕТ:
 * 1. Читает адрес стенда и учётные данные adenisov.test из локального файла окружения
 *    (по умолчанию ~/.openqareer/openqareer.env). Пароль не логируется и не попадает в вывод.
 * 2. Авторизуется и запрашивает кампанию и первые 20 вакансий подборки.
 * 3. Рассчитывает строгий счёт топ-20 по порогу MVP (B300 / B296 / C75):
 *    - роль в целевом семействе (target или partial без adjacentRole);
 *    - уровень match;
 *    - гео: удалённая работа или в профильных регионах (outsideGeography !== true);
 *    - требования: matchedRequirements >= 1.
 * 4. Сохраняет JSON в каталог `output/` с полями capturedAt, status, descriptionLength,
 *    requirementsTotal/Matched, строгим счётом и критериями.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readEnvironmentFile(file) {
  if (!existsSync(file)) {
    throw new Error(`Файл окружения не найден: ${file}`);
  }
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/gu, '');
  }
  return values;
}

function evaluateSingleRow(item, index) {
  const explanation = item.explanation ?? {};
  const cluster = item.cluster ?? {};
  const matchingPoints = explanation.matchingPoints ?? [];
  const missingPoints = explanation.missingPoints ?? [];

  const roleInFamily =
    explanation.roleMatch === 'target' ||
    (explanation.roleMatch === 'partial' && explanation.adjacentRole !== true);
  const levelOk = explanation.levelMatch === 'match';
  const geographyOk = cluster.isRemote === true || explanation.outsideGeography !== true;
  const requirementsMatched = matchingPoints.length;
  const requirementsTotal = matchingPoints.length + missingPoints.length;
  const requirementOk = requirementsMatched >= 1;
  const relevant = roleInFamily && levelOk && geographyOk && requirementOk;

  const description = item.fullDescription ?? item.description ?? cluster.description ?? '';
  const status = item.status ?? cluster.status ?? 'active';

  return {
    i: index + 1,
    id: item.id ?? cluster.id ?? `item-${index + 1}`,
    title: cluster.canonicalTitle ?? item.title ?? '',
    status,
    descriptionLength: typeof description === 'string' ? description.length : 0,
    requirementsMatched,
    requirementsTotal,
    req: { matched: requirementsMatched, total: requirementsTotal },
    roleMatch: explanation.roleMatch ?? null,
    adjacentRole: explanation.adjacentRole === true,
    levelMatch: explanation.levelMatch ?? null,
    isRemote: cluster.isRemote === true,
    outsideGeography: explanation.outsideGeography === true,
    relevant,
  };
}

export function evaluateStrictTop20(vacancies, campaign = {}) {
  const top20 = (Array.isArray(vacancies) ? vacancies : []).slice(0, 20);
  const rows = top20.map((item, index) => evaluateSingleRow(item, index));
  const strictScore = rows.filter((r) => r.relevant).length;
  const nowIso = new Date().toISOString();

  return {
    at: nowIso,
    capturedAt: nowIso,
    strictScore,
    threshold: 14,
    passed: strictScore >= 14,
    roleCounts: {
      target: rows.filter((r) => r.roleMatch === 'target').length,
      partial: rows.filter((r) => r.roleMatch === 'partial').length,
      adjacent: rows.filter((r) => r.adjacentRole).length,
    },
    levelMatchCount: rows.filter((r) => r.levelMatch === 'match').length,
    remoteCount: rows.filter((r) => r.isRemote).length,
    outsideGeographyCount: rows.filter((r) => r.outsideGeography).length,
    withRequirementMatchCount: rows.filter((r) => r.requirementsMatched >= 1).length,
    suggestedRegions: campaign?.suggestedRegions ?? [],
    rows,
  };
}

function parseCliArgument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export async function fetchStrictTop20(baseUrl, username, password) {
  const base = baseUrl.replace(/\/$/u, '');

  let healthSha = 'unknown';
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
    if (health.ok) healthSha = (await health.text()).trim();
  } catch {
    // Non-fatal if health endpoint is not available
  }

  const loginRes = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!loginRes.ok) {
    throw new Error(`Ошибка входа (${loginRes.status}): проверьте логин и пароль в файле окружения`);
  }

  const setCookie = loginRes.headers.getSetCookie();
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Сервер не вернул cookie сессии при входе');

  const headers = { cookie, accept: 'application/json' };

  const [campaignRes, vacanciesRes] = await Promise.all([
    fetch(`${base}/api/v1/candidate/campaign`, { headers, signal: AbortSignal.timeout(30_000) }),
    fetch(`${base}/api/v1/candidate/matched-vacancies`, { headers, signal: AbortSignal.timeout(60_000) }),
  ]);

  if (!vacanciesRes.ok) {
    throw new Error(`Ошибка запроса подборки: ${vacanciesRes.status}`);
  }

  const campaignJson = campaignRes.ok ? await campaignRes.json() : {};
  const vacanciesJson = await vacanciesRes.json();

  const vacancies = Array.isArray(vacanciesJson.data) ? vacanciesJson.data : [];
  const campaign = campaignJson.data ?? {};

  const evaluated = evaluateStrictTop20(vacancies, campaign);
  evaluated.healthSha = healthSha;
  return evaluated;
}

export async function main() {
  const base = parseCliArgument('base', 'https://openqareer.com');
  const envFile = parseCliArgument(
    'env',
    process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env'),
  );

  console.log(`Замер строгого топ-20: хост ${base}`);
  console.log(`Чтение учётных данных из: ${envFile}`);

  const env = readEnvironmentFile(envFile);
  const username = env.OPENQAREER_OWNER_TEST_USERNAME ?? 'adenisov.test';
  const password = env.OPENQAREER_OWNER_TEST_PASSWORD;

  if (!password) {
    throw new Error(`В файле ${envFile} отсутствует OPENQAREER_OWNER_TEST_PASSWORD`);
  }

  const evaluated = await fetchStrictTop20(base, username, password);

  console.log('\n--- Результаты первых 20 позиций ---');
  for (const row of evaluated.rows) {
    const mark = row.relevant ? '✓' : '✗';
    const reqStr = `${row.requirementsMatched}/${row.requirementsTotal}`;
    const descStr = `${row.descriptionLength} зн.`;
    console.log(
      `[${String(row.i).padStart(2, ' ')}] ${mark} req:${reqStr.padStart(5, ' ')} desc:${descStr.padStart(9, ' ')} | ${row.title.slice(0, 50)}`,
    );
  }

  console.log('\n--- Сводка строгого топ-20 (MVP) ---');
  console.log(`Строгий счёт: ${evaluated.strictScore}/20 (порог: ${evaluated.threshold})`);
  console.log(`Статус порога: ${evaluated.passed ? 'ПРОЙДЕН (PASS)' : 'НЕ ПРОЙДЕН (FAIL)'}`);
  console.log(`SHA релиза:    ${evaluated.healthSha}`);
  console.log(`Target роли:   ${evaluated.roleCounts.target}/20`);
  console.log(`Level match:   ${evaluated.levelMatchCount}/20`);
  console.log(`С требованиями: ${evaluated.withRequirementMatchCount}/20`);

  const outputDir = resolve(fileURLToPath(import.meta.url), '../../output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outputFile = join(outputDir, `strict-top20-${stamp}.json`);
  writeFileSync(outputFile, JSON.stringify(evaluated, null, 2), 'utf8');

  console.log(`\nОтчёт сохранён в: ${outputFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('Ошибка замера:', err.message);
    process.exit(1);
  });
}
