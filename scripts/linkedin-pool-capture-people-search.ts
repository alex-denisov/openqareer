/**
 * B369 — одноразовое снятие живых страниц для парсера рекрутёров.
 * Открывает из серверной сессии аккаунта пула: поиск компании → страницу
 * компании (ID для фильтра) → поиск людей `currentCompany=<id>&keywords=<слово>`.
 * Сохраняет HTML в <outDir>; состояние пула не меняет.
 * Запуск на хосте пользователем обслуживания с его окружением:
 *   node linkedin-pool-capture-people-search.mjs <accountId> <company> <outDir> [keyword]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readServerConfig } from '../server/config';
import { SqliteLinkedinPoolRepository } from '../server/linkedinPool/sqliteLinkedinPoolRepository';
import { launchLinkedinPersistentContext } from '../server/linkedinPool/linkedinPersistentContext';
import {
  acquireProfileLock,
  linkedinProfileDirectory,
  releaseProfileLock,
} from '../server/linkedinPool/linkedinProfileDirectory';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForProfile(profile: string): Promise<void> {
  for (let tries = 0; !acquireProfileLock(profile, 'login'); tries += 1) {
    if (tries > 60) throw new Error('profile_busy');
    await pause(10_000);
  }
}

async function main(): Promise<void> {
  const [accountId, company, outDir, keyword = 'recruiter'] = process.argv.slice(2);
  if (!accountId || !company || !outDir) throw new Error('usage: <accountId> <company> <outDir> [keyword]');
  mkdirSync(outDir, { recursive: true });
  const config = readServerConfig(process.env);
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
    ...(config.linkedinRuntimeRoot ? { runtimeRoot: config.linkedinRuntimeRoot } : {}),
  });
  const account = repository.findAccount(accountId);
  // Тот же постоянный профиль, что у исполнителя (B373); ждём, пока он свободен.
  const profile = linkedinProfileDirectory(config.databasePath, accountId);
  await waitForProfile(profile);
  const module = process.env.OPENQAREER_PLAYWRIGHT_MODULE?.trim();
  const { chromium } = await import(module ? pathToFileURL(module).href : 'playwright');
  const context = await launchLinkedinPersistentContext(chromium, profile, { timezone: account?.timezone || 'Europe/Berlin' });
  try {
    const page = await context.newPage();
    const save = async (name: string) => {
      await page.waitForTimeout(5_000);
      writeFileSync(join(outDir, `${name}.html`), await page.content());
      console.log(JSON.stringify({ name, url: page.url(), title: (await page.title()).slice(0, 80) }));
    };
    const search = new URL('https://www.linkedin.com/search/results/companies/');
    search.searchParams.set('keywords', company);
    await page.goto(search.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await save('company-search');
    const companyHref = await page.locator('a[href*="/company/"]').first().getAttribute('href');
    if (!companyHref) return;
    await pause(8_000);
    await page.goto(new URL(companyHref, 'https://www.linkedin.com').href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await save('company-page');
    const html = await page.content();
    const id = html.match(/urn:li:(?:fsd_company|fs_miniCompany|organization|company):(\d+)/u)?.[1];
    console.log(JSON.stringify({ companyId: id ?? null }));
    if (!id) return;
    await pause(9_000);
    const people = new URL('https://www.linkedin.com/search/results/people/');
    people.searchParams.set('currentCompany', JSON.stringify([id]));
    people.searchParams.set('keywords', keyword);
    people.searchParams.set('origin', 'FACETED_SEARCH');
    await page.goto(people.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await save('people-search');
  } finally {
    await context.close();
    releaseProfileLock(profile, 'login');
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: String(error).slice(0, 300) }));
  process.exitCode = 1;
});
