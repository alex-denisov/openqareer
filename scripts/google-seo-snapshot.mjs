#!/usr/bin/env node
/**
 * Мониторинг Google Search Console API (B227).
 *
 * Снимает показатели эффективности поиска (клики, показы, CTR, средняя позиция)
 * и статус индексации sitemap.xml через официальный Search Console API.
 *
 * Печатает структурированный отчет и готовую строку для docs/v1-release/seo/JOURNAL.md.
 * Токены читаются из ~/.openqareer/openqareer.env или переменных окружения.
 *
 * Запуск:
 *   node scripts/google-seo-snapshot.mjs
 *   node scripts/google-seo-snapshot.mjs --mock
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');
const SITE_URL = 'https://openqareer.com/';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

function loadCredentials(file) {
  const fileEnv = readEnvFile(file);
  const token = process.env.GOOGLE_SEARCH_CONSOLE_TOKEN || fileEnv.GOOGLE_SEARCH_CONSOLE_TOKEN;
  if (token) return { type: 'token', token };

  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || fileEnv.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && existsSync(keyPath)) {
    const keyJson = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (keyJson.client_email && keyJson.private_key) {
      return {
        type: 'service_account',
        clientEmail: keyJson.client_email,
        privateKey: keyJson.private_key,
      };
    }
  }

  const clientEmail =
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL || fileEnv.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL;
  const privateKey =
    process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY || fileEnv.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return { type: 'service_account', clientEmail, privateKey };
  }

  return null;
}

function createServiceAccountJwt(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: OAUTH_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  ).toString('base64url');

  const signInput = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  const signature = signer.sign(formattedKey, 'base64url');

  return `${signInput}.${signature}`;
}

async function fetchAccessToken(clientEmail, privateKey) {
  const assertion = createServiceAccountJwt(clientEmail, privateKey);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Google OAuth2 error HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function querySearchAnalytics(accessToken, siteUrl) {
  const encoded = encodeURIComponent(siteUrl);
  const end = new Date();
  const start = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        rowLimit: 1,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Search Console SearchAnalytics API error HTTP ${response.status}`);
  }
  return response.json();
}

async function querySitemaps(accessToken, siteUrl) {
  const encoded = encodeURIComponent(siteUrl);
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/sitemaps`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Search Console Sitemaps API error HTTP ${response.status}`);
  }
  return response.json();
}

function formatCtr(ctr) {
  if (ctr === undefined || ctr === null || Number(ctr) === 0) return '0%';
  const num = Number(ctr);
  const percent = num <= 1 ? num * 100 : num;
  return `${percent.toFixed(1)}%`;
}

function formatPosition(pos) {
  if (pos === undefined || pos === null || Number(pos) === 0) return '—';
  return Number(pos).toFixed(1);
}

function printSnapshot({ today, clicks, impressions, ctr, position, sitemapStatus }) {
  const ctrStr = formatCtr(ctr);
  const posStr = formatPosition(position);

  process.stdout.write(`Замер ${today}, Google Search Console, ${SITE_URL}\n`);
  process.stdout.write(`  клики: ${clicks}\n`);
  process.stdout.write(`  показы: ${impressions}\n`);
  process.stdout.write(`  CTR: ${ctrStr}\n`);
  process.stdout.write(`  средняя позиция: ${posStr}\n`);
  process.stdout.write(`  карта сайта: ${sitemapStatus}\n`);

  process.stdout.write('\nСтрока для журнала:\n');
  process.stdout.write(
    `| ${today} | клики / показы (Google) | ${clicks} / ${impressions} (CTR: ${ctrStr}) | Google Search Console API | |\n`,
  );
}

function runMock() {
  const today = new Date().toISOString().slice(0, 10);
  printSnapshot({
    today,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    sitemapStatus: 'https://openqareer.com/sitemap.xml (обработана: 2 770 URL, ошибок 0)',
  });
}

async function main() {
  const isMock = process.argv.includes('--mock');
  if (isMock) {
    runMock();
    return;
  }

  const credentials = loadCredentials(ENV_FILE);
  if (!credentials) {
    process.stdout.write(
      `в ${ENV_FILE} нет учетных данных Google Search Console — замер невозможен\n`,
    );
    process.exit(1);
  }

  const accessToken =
    credentials.type === 'token'
      ? credentials.token
      : await fetchAccessToken(credentials.clientEmail, credentials.privateKey);

  const analytics = await querySearchAnalytics(accessToken, SITE_URL);
  const sitemaps = await querySitemaps(accessToken, SITE_URL);

  const topRow = analytics.rows?.[0] ?? {};
  const sitemapList = sitemaps.sitemap ?? [];
  const mainSitemap = sitemapList.find((s) => s.path?.includes('sitemap.xml'));
  const sitemapStatus = mainSitemap
    ? `${mainSitemap.path} (последнее сканирование: ${mainSitemap.lastDownloaded ?? 'не сканировалась'}, ошибок: ${mainSitemap.errors ?? 0})`
    : 'sitemap.xml не найдена в аккаунте';

  const today = new Date().toISOString().slice(0, 10);
  printSnapshot({
    today,
    clicks: topRow.clicks ?? 0,
    impressions: topRow.impressions ?? 0,
    ctr: topRow.ctr ?? 0,
    position: topRow.position ?? 0,
    sitemapStatus,
  });
}

main().catch((err) => {
  process.stderr.write(`Ошибка Google Search Console: ${err.message}\n`);
  process.exit(1);
});
