/**
 * B157 live gate — the whole hh.ru import path, end to end, with no human.
 *
 * Signs in to the dedicated hh.ru test account, captures the resume list and
 * the chosen resume **exactly the way the desktop shell captures them**
 * (`read_session_page` strips every attribute except `data-qa`, `class` and
 * resume `href`s), runs the product's own parsers over that DOM, then imports
 * the result through the real candidate API and prints the server's real
 * answer.
 *
 * This is the gate that would have caught the owner's 2026-08-26 report: the
 * read succeeded and the import was refused, and nothing on screen said why.
 *
 * It never prints a credential and never writes to hh.ru.
 *
 *   npm run verify:hh-session-import
 *   npm run verify:hh-session-import -- --headed --api=http://127.0.0.1:3210
 */
import { readFile } from 'node:fs/promises';
import { chromium, webkit, type Page } from 'playwright';
import { parseHhResumeHtml, parseHhResumesList } from '../src/services/connectors/hhResumeParser';
import { HH_SELECTORS } from '../server/connectors/hh/hhSelectors';
import {
  parseEnvironmentFile,
  resolveHhTestAccountEnvironment,
} from '../server/connectors/hh/hhTestAccountEnvironment';
import { resolveLocalEnvironmentFilePath } from '../server/localEnvironmentFile';

const headed = process.argv.includes('--headed');
/**
 * The desktop shell reads the page inside a WKWebView, so `--webkit` is the
 * engine that actually matters; Chromium is the faster everyday check. A
 * platform that serves different markup to the two would break the product
 * while the gate stayed green.
 */
const engine = process.argv.includes('--webkit') ? webkit : chromium;
const apiBase =
  process.argv.find((arg) => arg.startsWith('--api='))?.slice('--api='.length) ??
  'https://openqareer.com';
const STEP_TIMEOUT_MS = 20_000;

/**
 * The desktop shell's own capture, copied verbatim from `read_session_page`
 * in `src-tauri/src/connector_session.rs`. A gate that reads a richer DOM than
 * the product does proves nothing about the product.
 */
const CAPTURE_SCRIPT = `(function(){try{
const source=document.querySelector('main')||document.body||document.documentElement;
const root=source.cloneNode(true);
root.querySelectorAll('script,style,noscript,iframe,object,embed,input,textarea,select,meta,link').forEach(function(node){node.remove();});
root.querySelectorAll('*').forEach(function(node){
const qa=node.getAttribute('data-qa');
const className=node.getAttribute('class');
const href=node.getAttribute('href');
Array.from(node.attributes).forEach(function(attribute){node.removeAttribute(attribute.name);});
if(qa&&qa.length<=160){node.setAttribute('data-qa',qa);}
if(className&&className.length<=500){node.setAttribute('class',className);}
if(href){try{const parsed=new URL(href,location.origin);if(/^\\/resume\\/[A-Za-z0-9_-]+$/u.test(parsed.pathname)){node.setAttribute('href',parsed.pathname);}}catch(e){}}
});
const body=root.outerHTML;
return body.length>2000000?'__OPENQAREER_PAGE_TOO_LARGE__':body;
}catch(e){return '';}})()`;

function report(step: string, detail: unknown): void {
  process.stdout.write(`${step}: ${JSON.stringify(detail, null, 2)}\n`);
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('https://hh.ru/account/login', { waitUntil: 'domcontentloaded' });
  if (await page.locator(HH_SELECTORS.security.applicantProfile).count()) return;

  // The radios are already selected by default and their visible label sits on
  // top of the input, so a plain click is intercepted: `check` is a no-op when
  // the choice is the one hh.ru already made.
  const applicant = page.locator(HH_SELECTORS.login.accountTypeApplicant).first();
  if (await applicant.count()) {
    await applicant.check({ force: true, timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
    await page.locator(HH_SELECTORS.login.submit).first().click();
    await page.waitForTimeout(1_000);
  }
  const email = page.locator(HH_SELECTORS.login.credentialTypeEmail).first();
  if (await email.count()) {
    await email.check({ force: true, timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
  }
  await page
    .locator(HH_SELECTORS.login.emailInput)
    .first()
    .fill(username, { timeout: STEP_TIMEOUT_MS });
  const byPassword = page.locator(HH_SELECTORS.login.expandPassword).first();
  if (await byPassword.isVisible({ timeout: STEP_TIMEOUT_MS }).catch(() => false)) {
    await byPassword.click();
  }
  await page
    .locator(HH_SELECTORS.login.passwordInput)
    .first()
    .fill(password, { timeout: STEP_TIMEOUT_MS });
  await page.locator(HH_SELECTORS.login.submit).first().click();
  await page
    .locator(HH_SELECTORS.security.applicantProfile)
    .first()
    .waitFor({ state: 'attached', timeout: STEP_TIMEOUT_MS });
}

async function capture(page: Page, url: string): Promise<{ url: string; body: string }> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
  const body = await page.evaluate<string>(CAPTURE_SCRIPT);
  return { url: page.url(), body };
}

const environmentFile = resolveLocalEnvironmentFilePath();
const fileContents = await readFile(environmentFile, 'utf8').catch(() => null);
const environment = resolveHhTestAccountEnvironment(process.env, fileContents);
const fromFile = fileContents ? parseEnvironmentFile(fileContents) : {};
const hhUser = environment.OPENQAREER_HH_TEST_USERNAME;
const hhPassword = environment.OPENQAREER_HH_TEST_PASSWORD;
const candidateUser =
  process.env.OPENQAREER_TEST_CANDIDATE_USERNAME || fromFile.OPENQAREER_TEST_CANDIDATE_USERNAME;
const candidatePassword =
  process.env.OPENQAREER_TEST_CANDIDATE_PASSWORD || fromFile.OPENQAREER_TEST_CANDIDATE_PASSWORD;
if (!hhUser || !hhPassword || !candidateUser || !candidatePassword) {
  report('environment', { status: 'missing', environmentFile });
  process.exit(2);
}

const browser = await engine.launch({ headless: !headed });
const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
const page = await context.newPage();
let exitCode = 0;
try {
  await signIn(page, hhUser, hhPassword);
  report('hh-sign-in', { signedIn: true, url: page.url() });

  const list = await capture(page, 'https://hh.ru/applicant/resumes');
  const resumes = parseHhResumesList(list.body);
  report('resume-list', { url: list.url, bodyChars: list.body.length, resumes });
  if (resumes.length === 0) throw new Error('hh_resume_list_empty');

  const chosen = resumes[0];
  const detail = await capture(page, chosen.url);
  if (process.env.OPENQAREER_DUMP_CAPTURE) {
    await (
      await import('node:fs/promises')
    ).writeFile(process.env.OPENQAREER_DUMP_CAPTURE, detail.body, 'utf8');
  }
  const parsed = parseHhResumeHtml(detail.body, chosen.url);
  report('parsed-resume', {
    url: detail.url,
    bodyChars: detail.body.length,
    fullName: Boolean(parsed.fullName),
    targetRole: parsed.targetRole,
    experience: parsed.experience.length,
    skills: parsed.skills.length,
    education: parsed.education.length,
    languages: parsed.languages.length,
    rawTextChars: parsed.rawText.length,
    rawTextPreview: parsed.rawText.slice(0, 400),
  });

  const login = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: apiBase },
    body: JSON.stringify({ username: candidateUser, password: candidatePassword }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  report('api-login', { status: login.status, hasSession: Boolean(cookie) });
  if (!login.ok) throw new Error(`api_login_failed_${login.status}`);

  // Every run must be a real first import: the API replays an identical one
  // idempotently, and a replay proves nothing about the path under test.
  const released = await fetch(`${apiBase}/api/v1/candidate/connections/hh`, {
    method: 'DELETE',
    headers: { Origin: apiBase, Cookie: cookie },
  });
  report('api-release', { status: released.status });

  const imported = await fetch(`${apiBase}/api/v1/candidate/resume/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: apiBase, Cookie: cookie },
    body: JSON.stringify({
      text: parsed.rawText,
      source: 'hh',
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: chosen.url,
        capturedAt: new Date().toISOString(),
      },
    }),
  });
  const payload = (await imported.json().catch(() => null)) as Record<string, unknown> | null;
  const data = payload?.data as Record<string, unknown> | undefined;
  report('api-import', {
    status: imported.status,
    ok: imported.ok,
    error: payload?.error ?? null,
    factCount: data?.factCount ?? null,
    connection: data?.connection ? 'present' : 'absent',
  });
  if (!imported.ok || !data?.connection) exitCode = 1;
} catch (reason) {
  report('failure', { message: reason instanceof Error ? reason.message : String(reason) });
  exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
process.exit(exitCode);
