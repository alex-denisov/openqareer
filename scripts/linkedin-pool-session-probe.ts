/**
 * One-page health check of a pool account's server session, outside the
 * cadence windows. Opens linkedin.com/feed with the stored cookies, from the
 * same host and browser the executor uses, and reports where LinkedIn sent it:
 * the feed (session alive), the login form, or a security checkpoint.
 *
 * Read-only for the pool: it changes no account state and stores nothing.
 * Run on the prod host as the maintenance user with its environment:
 *   node linkedin-pool-session-probe.mjs <accountId>
 */
import { pathToFileURL } from 'node:url';
import { readServerConfig } from '../server/config';
import { SqliteLinkedinPoolRepository } from '../server/linkedinPool/sqliteLinkedinPoolRepository';

const FEED_URL = 'https://www.linkedin.com/feed/';

type Verdict = 'signed_in' | 'login_required' | 'checkpoint' | 'unknown';

export function classifyLinkedinLanding(url: string, hasGlobalNav: boolean, title = ''): Verdict {
  const path = new URL(url).pathname;
  if (path.startsWith('/checkpoint') || path.includes('/challenge')) return 'checkpoint';
  if (path.startsWith('/login') || path.startsWith('/uas/login') || path.startsWith('/authwall')) {
    return 'login_required';
  }
  // A signed-out /feed request is redirected to /login or /authwall; the nav
  // markup changes often, the signed-in feed title does not.
  if (path.startsWith('/feed') && (hasGlobalNav || title.startsWith('Feed'))) return 'signed_in';
  return 'unknown';
}

async function main(): Promise<void> {
  const accountId = process.argv[2];
  if (!accountId) throw new Error('usage: linkedin-pool-session-probe <accountId>');
  const config = readServerConfig(process.env);
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
    ...(config.linkedinRuntimeRoot ? { runtimeRoot: config.linkedinRuntimeRoot } : {}),
  });
  const cookies = repository.readSessionCookies(accountId);
  if (!cookies?.some((cookie) => cookie.name === 'li_at')) {
    console.log(JSON.stringify({ verdict: 'no_server_session' }));
    return;
  }
  const module = process.env.OPENQAREER_PLAYWRIGHT_MODULE?.trim();
  const { chromium } = await import(module ? pathToFileURL(module).href : 'playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
        ...(cookie.expiresAt ? { expires: cookie.expiresAt } : {}),
      })),
    );
    const page = await context.newPage();
    const response = await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);
    const hasGlobalNav = (await page.locator('#global-nav, nav.global-nav').count()) > 0;
    const title = await page.title();
    console.log(
      JSON.stringify({
        verdict: classifyLinkedinLanding(page.url(), hasGlobalNav, title),
        status: response?.status() ?? null,
        landedPath: new URL(page.url()).pathname,
        hasGlobalNav,
        title: title.slice(0, 80),
      }),
    );
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ verdict: 'probe_failed', error: String(error).slice(0, 300) }));
    process.exitCode = 1;
  });
}
