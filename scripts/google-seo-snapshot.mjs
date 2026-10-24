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
import { inspectionLimit, selectRootSitemap, jobPostingEvidence, publicGoogleError } from './google-seo-audit.mjs';
import { querySearchAnalytics, searchAnalyticsTotals, exchangeSearchConsoleToken, SEARCH_CONSOLE_TOKEN_URL, readSearchConsoleJson } from './search-console-client.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchSitemapUrls } from './seo-sitemap-urls.mjs';

const ENV_FILE = process.env.OPENQAREER_ENV_FILE ?? join(homedir(), '.openqareer/openqareer.env');
const SITE_URL = 'https://openqareer.com/';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SNAPSHOT_DIR =
  process.env.GOOGLE_SEO_SNAPSHOT_DIR ?? join(process.cwd(), 'docs/v1-release/seo/google-snapshots');

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
      aud: SEARCH_CONSOLE_TOKEN_URL,
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
  return exchangeSearchConsoleToken(createServiceAccountJwt(clientEmail, privateKey));
}

async function querySitemaps(accessToken, siteUrl) {
  const encoded = encodeURIComponent(siteUrl);
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/sitemaps`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    },
  );

  if (!response.ok) {
    throw new Error(`Search Console Sitemaps API error HTTP ${response.status}`);
  }
  return readSearchConsoleJson(response);
}

function sampleEvenly(values, limit) {
  if (values.length <= limit) return values;
  const step = (values.length - 1) / Math.max(1, limit - 1);
  return Array.from({ length: limit }, (_, index) => values[Math.round(index * step)]);
}

async function inspectUrl(accessToken, siteUrl, inspectedUrl) {
  const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000), redirect: 'error',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: inspectedUrl, siteUrl }),
  });
  if (!response.ok) return { url: inspectedUrl, status: `http_${response.status}` };
  const result = (await readSearchConsoleJson(response)).inspectionResult?.indexStatusResult ?? {};
  return {
    url: inspectedUrl,
    status: result.verdict ?? 'unknown',
    coverageState: result.coverageState ?? null,
    lastCrawlTime: result.lastCrawlTime ?? null,
    robotsTxtState: result.robotsTxtState ?? null,
    indexingState: result.indexingState ?? null,
  };
}

async function auditJobPosting(urls) {
  const required = ['datePosted', 'hiringOrganization', 'title', 'description'];
  const rows = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'openqareer-seo-audit/1.0' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
      const html = await response.text();
      rows.push({ url, httpStatus: response.status, ...jobPostingEvidence(html) });
    } catch {
      rows.push({ url, httpStatus: null, jobPosting: false, missing: required, error: 'request_or_response_failed' });
    }
  }
  return {
    sampled: rows.length,
    valid: rows.filter((row) => row.httpStatus === 200 && row.jobPosting && row.missing.length === 0).length,
    gone410: rows.filter((row) => row.httpStatus === 410).length,
    rows,
  };
}

function persistSnapshot(snapshot) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const suffix = snapshot.mode === 'official_api' ? '' : snapshot.mode === 'synthetic_fixture' ? '.fixture' : '.unavailable';
  const path = join(SNAPSHOT_DIR, `${snapshot.today}${suffix}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
  return path;
}

function formatCtr(ctr) {
  if (ctr === undefined || ctr === null) return 'нет данных';
  if (Number(ctr) === 0) return '0%';
  const num = Number(ctr);
  const percent = num <= 1 ? num * 100 : num;
  return `${percent.toFixed(1)}%`;
}

function formatPosition(pos) {
  if (pos === undefined || pos === null || Number(pos) === 0) return '—';
  return Number(pos).toFixed(1);
}

function printSnapshot({ today, clicks, impressions, ctr, position, sitemapStatus, mode }) {
  const ctrStr = formatCtr(ctr);
  const posStr = formatPosition(position);

  process.stdout.write(`Замер ${today}, Google Search Console, ${SITE_URL}\n`);
  process.stdout.write(`  режим: ${mode}\n`);
  process.stdout.write(`  клики: ${clicks ?? 'нет данных'}\n`);
  process.stdout.write(`  показы: ${impressions ?? 'нет данных'}\n`);
  process.stdout.write(`  CTR: ${ctrStr}\n`);
  process.stdout.write(`  средняя позиция: ${posStr}\n`);
  process.stdout.write(`  карта сайта: ${sitemapStatus}\n`);

  process.stdout.write('\nСтрока для журнала:\n');
  process.stdout.write(
    `| ${today} | клики / показы (Google) | ${clicks ?? 'нет данных'} / ${impressions ?? 'нет данных'} (CTR: ${ctrStr}) | ${mode === 'official_api' ? 'Google Search Console API' : 'synthetic fixture — не замер Google'} | |\n`,
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
    sitemapStatus: 'synthetic fixture; состояние sitemap не измерялось',
    mode: 'synthetic_fixture',
  });
  return {
    today,
    mode: 'synthetic_fixture',
    siteUrl: SITE_URL,
    searchAnalytics: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    indexInspection: { sampled: 0, indexed: 0, excluded: 0, note: 'synthetic fixture; Google API не вызывался' },
    jobPostingAudit: { sampled: 0, valid: 0, gone410: 0, rows: [] },
  };
}

// eslint-disable-next-line max-lines-per-function
async function main() {
  const isMock = process.argv.includes('--mock');
  if (isMock) {
    const snapshot = runMock();
    process.stdout.write(`  snapshot: ${persistSnapshot(snapshot)}\n`);
    return;
  }

  const credentials = loadCredentials(ENV_FILE);
  if (!credentials) {
    persistSnapshot({today:new Date().toISOString().slice(0,10),observedAt:new Date().toISOString(),mode:'operational_check',status:'unavailable',reason:'credentials_missing'});
    process.stdout.write(
      `в ${ENV_FILE} нет учетных данных Google Search Console — замер невозможен\n`,
    );
    process.exit(1);
  }

  const accessToken =
    credentials.type === 'token'
      ? credentials.token
      : await fetchAccessToken(credentials.clientEmail, credentials.privateKey);

  const observationTime = new Date();
  const analytics = await querySearchAnalytics(accessToken, SITE_URL, { now: observationTime });
  const queryReport = await querySearchAnalytics(accessToken, SITE_URL, { byQuery: true, now: observationTime })
    .then(data => ({ status: 'available', ...data }))
    .catch(() => ({ status: 'unavailable' }));
  const sitemaps = await querySitemaps(accessToken, SITE_URL);

  const topRow = searchAnalyticsTotals(analytics);
  const sitemapList = sitemaps.sitemap ?? [];
  const mainSitemap = selectRootSitemap(sitemapList);
  const sitemapStatus = mainSitemap
    ? `${mainSitemap.path} (последнее сканирование: ${mainSitemap.lastDownloaded ?? 'не сканировалась'}, ошибок: ${mainSitemap.errors ?? 0})`
    : 'sitemap.xml не найдена в аккаунте';

  const today = new Date().toISOString().slice(0, 10);
  const inspectionBudget = inspectionLimit(process.env.GOOGLE_SEO_INSPECTION_LIMIT);
  const sitemapUrls = mainSitemap?.path ? await fetchSitemapUrls(mainSitemap.path) : [];
  const sampledUrls = sampleEvenly(sitemapUrls, inspectionBudget);
  const inspections = [];
  for (const url of sampledUrls) inspections.push(await inspectUrl(accessToken, SITE_URL, url));
  const jobPostingAudit = await auditJobPosting(sampledUrls.filter(url => new URL(url).pathname.startsWith('/vacancies/job/')));
  const snapshot = {
    today,
    mode: 'official_api',
    siteUrl: SITE_URL,
    requestedWindow: analytics.requestedWindow,
    topQueries: queryReport,
    searchAnalytics: {
      clicks: topRow.clicks,
      impressions: topRow.impressions,
      ctr: topRow.ctr,
      position: topRow.position,
    },
    sitemap: { submitted: mainSitemap?.path ?? null, urls: sitemapUrls.length, sampled: sampledUrls.length },
    indexInspection: {
      sampled: inspections.length,
      indexed: inspections.filter((item) => item.status === 'PASS').length,
      notConfirmed: inspections.filter((item) => item.status !== 'PASS').length,
      rows: inspections,
    },
    jobPostingAudit,
  };
  const snapshotPath = persistSnapshot(snapshot);
  printSnapshot({
    today,
    clicks: topRow.clicks,
    impressions: topRow.impressions,
    ctr: topRow.ctr,
    position: topRow.position,
    sitemapStatus,
    mode: 'official_api',
  });
  process.stdout.write(`  URL Inspection: ${snapshot.indexInspection.indexed}/${snapshot.indexInspection.sampled} indexed\n`);
  process.stdout.write(`  JobPosting: ${jobPostingAudit.valid}/${jobPostingAudit.sampled} valid, 410 Gone: ${jobPostingAudit.gone410}\n`);
  process.stdout.write(`  snapshot: ${snapshotPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`Ошибка Google Search Console: ${publicGoogleError(err)}\n`);
  process.exit(1);
});
