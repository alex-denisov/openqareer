import type {
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
} from 'playwright';
import { HH_SELECTORS } from './hhSelectors';

const HH_LOGIN_URL = 'https://hh.ru/account/login';
const HH_RESUMES_PATH = '/applicant/resumes';
const HH_HOSTS = new Set(['hh.ru', 'www.hh.ru']);

export type HhBrowserLoginStatus =
  | 'ready'
  | 'challenge'
  | 'mfa'
  | 'invalid'
  | 'surface_changed';

export type HhBrowserLoginReason =
  | 'candidate_resume_identity_verified'
  | 'candidate_session_confirmed'
  | 'credential_environment_missing'
  | 'login_rejected'
  | 'challenge_detected'
  | 'mfa_required'
  | 'login_surface_changed'
  | 'candidate_surface_changed'
  | 'identity_marker_missing'
  | 'identity_marker_mismatch'
  | 'resume_marker_missing'
  | 'browser_navigation_failed'
  | 'context_close_failed';

/**
 * What the run actually proved, never more:
 * - `candidate_resume_owner_match` — hh.ru showed an account email and it is the
 *   configured test account.
 * - `signed_in_applicant_session` — an applicant session with its own resumes
 *   was confirmed, but hh.ru exposed no account email to bind it to (the live
 *   `/applicant/resumes` surface does not render one). Enough to read; not proof
 *   of which account. Binding a specific account needs an owner-supplied
 *   expected identity — see the B130 work log.
 */
export type HhIdentityMarker =
  | 'candidate_resume_owner_match'
  | 'signed_in_applicant_session';

export interface HhBrowserLoginResult {
  readonly status: HhBrowserLoginStatus;
  readonly reason: HhBrowserLoginReason;
  readonly identityMarker: HhIdentityMarker | null;
  readonly observedAt: string;
}

export interface HhBrowserFactory {
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
}

interface VerifyHhTestAccountOptions {
  environment: Record<string, string | undefined>;
  observedAt?: () => string;
  timeoutMs?: number;
}

/**
 * Read-only hh.ru test-account verifier for the B120/B123 evidence sequence.
 *
 * It performs exactly one sign-in and one candidate-surface read: it never
 * submits an application, never publishes a resume and never persists storage
 * state. Credentials come from the environment and are never written into the
 * result, so the receipt stays safe to log. A CAPTCHA or a one-time-code prompt
 * is a fail-closed stop reported to the owner, never something to solve.
 *
 * Surface detection uses the catalogued `data-qa` markers rather than localized
 * copy, so a Russian/English interface switch cannot silently flip the verdict.
 */
export async function verifyHhTestAccount(
  browser: HhBrowserFactory,
  options: VerifyHhTestAccountOptions,
): Promise<HhBrowserLoginResult> {
  const observedAt = options.observedAt ?? (() => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const username = options.environment.OPENQAREER_HH_TEST_USERNAME?.trim();
  const password = options.environment.OPENQAREER_HH_TEST_PASSWORD;
  if (!username || !password) {
    return result('invalid', 'credential_environment_missing', observedAt());
  }

  let context: BrowserContext | undefined;
  let verification = result(
    'surface_changed',
    'browser_navigation_failed',
    observedAt(),
  );
  try {
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      storageState: undefined,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(HH_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    verification = await signInAndVerify(page, {
      username,
      password,
      timeoutMs,
      observedAt,
    });
  } catch {
    verification = result(
      'surface_changed',
      'browser_navigation_failed',
      observedAt(),
    );
  }
  return closeContext(context, verification, observedAt);
}

/** The session is never persisted: a context that survives is itself a defect. */
async function closeContext(
  context: BrowserContext | undefined,
  verification: HhBrowserLoginResult,
  observedAt: () => string,
): Promise<HhBrowserLoginResult> {
  if (!context) return verification;
  try {
    await context.close();
    return verification;
  } catch {
    return result('surface_changed', 'context_close_failed', observedAt());
  }
}

interface SignInOptions {
  username: string;
  password: string;
  timeoutMs: number;
  observedAt: () => string;
}

async function signInAndVerify(
  page: Page,
  options: SignInOptions,
): Promise<HhBrowserLoginResult> {
  const { username, timeoutMs, observedAt } = options;
  if (await challengeVisible(page)) {
    return result('challenge', 'challenge_detected', observedAt());
  }

  const signIn =
    (await chooseApplicantAccount(page, timeoutMs, observedAt)) ??
    (await enterEmailCredential(page, options)) ??
    (await enterPassword(page, options));
  if (signIn) return signIn;

  const settled = await settleAfterSubmit(page, options);
  if (settled) return settled;
  return verifyCandidateIdentity(page, username, observedAt());
}

/** Step 1 — hh.ru asks which account type is signing in before anything else. */
async function chooseApplicantAccount(
  page: Page,
  timeoutMs: number,
  observedAt: () => string,
): Promise<HhBrowserLoginResult | null> {
  const submit = page.locator(HH_SELECTORS.login.submit).first();
  if (
    !(await selectRadio(
      page,
      HH_SELECTORS.login.accountTypeApplicant,
      timeoutMs,
    )) ||
    !(await isVisible(submit, timeoutMs))
  ) {
    return result('surface_changed', 'login_surface_changed', observedAt());
  }
  await submit.click();
  return null;
}

/** Step 2 — switch from the default phone-code path to email, then to password. */
async function enterEmailCredential(
  page: Page,
  { username, timeoutMs, observedAt }: SignInOptions,
): Promise<HhBrowserLoginResult | null> {
  if (
    !(await selectRadio(
      page,
      HH_SELECTORS.login.credentialTypeEmail,
      timeoutMs,
    ))
  ) {
    return result('surface_changed', 'login_surface_changed', observedAt());
  }

  const emailField = page.locator(HH_SELECTORS.login.emailInput).first();
  const passwordMode = page.locator(HH_SELECTORS.login.expandPassword).first();
  if (
    !(await isVisible(emailField, timeoutMs)) ||
    !(await isVisible(passwordMode, timeoutMs))
  ) {
    return result('surface_changed', 'login_surface_changed', observedAt());
  }
  await emailField.fill(username);
  await passwordMode.click();
  return null;
}

/** Step 3 — the password surface only exists once an email has been supplied. */
async function enterPassword(
  page: Page,
  { password, timeoutMs, observedAt }: SignInOptions,
): Promise<HhBrowserLoginResult | null> {
  const passwordField = page.locator(HH_SELECTORS.login.passwordInput).first();
  const submit = page.locator(HH_SELECTORS.login.submit).first();
  if (
    !(await isVisible(passwordField, timeoutMs)) ||
    !(await isVisible(submit, timeoutMs))
  ) {
    return result('surface_changed', 'login_surface_changed', observedAt());
  }
  await passwordField.fill(password);
  await submit.click();
  return null;
}

/**
 * hh.ru lands a signed-in applicant on its own start page, so the resume list
 * is requested explicitly. Anything that is not that page is a stop.
 */
async function settleAfterSubmit(
  page: Page,
  { timeoutMs, observedAt }: SignInOptions,
): Promise<HhBrowserLoginResult | null> {
  await page
    .waitForURL((url) => url.pathname !== '/account/login', {
      timeout: timeoutMs,
    })
    .catch(() => undefined);

  if (await challengeVisible(page)) {
    return result('challenge', 'challenge_detected', observedAt());
  }
  if (await isVisible(oneTimeCodeField(page), 0)) {
    return result('mfa', 'mfa_required', observedAt());
  }
  if (await isVisible(loginError(page), 0)) {
    return result('invalid', 'login_rejected', observedAt());
  }
  if (!isCandidateResumesUrl(page.url())) {
    try {
      await page.goto(`https://hh.ru${HH_RESUMES_PATH}`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
    } catch {
      return result(
        'surface_changed',
        'browser_navigation_failed',
        observedAt(),
      );
    }
  }
  if (!isCandidateResumesUrl(page.url())) {
    return result('surface_changed', 'browser_navigation_failed', observedAt());
  }
  return null;
}

async function verifyCandidateIdentity(
  page: Page,
  expectedUsername: string,
  observedAt: string,
): Promise<HhBrowserLoginResult> {
  // Signed-in-only nodes; hh.ru keeps responsive variants attached but hidden.
  if ((await page.locator(HH_SELECTORS.security.applicantProfile).count()) === 0) {
    return result('surface_changed', 'candidate_surface_changed', observedAt);
  }
  if (!(await isVisible(page.locator(HH_SELECTORS.resume.item), 0))) {
    return result('surface_changed', 'resume_marker_missing', observedAt);
  }

  const identityMarker = page
    .locator(HH_SELECTORS.identity.applicantEmail)
    .first();
  if (!(await isVisible(identityMarker, 0))) {
    // hh.ru does not print the account email on this surface. Report the
    // weaker fact rather than passing a session off as identity-bound.
    return result(
      'ready',
      'candidate_session_confirmed',
      observedAt,
      'signed_in_applicant_session',
    );
  }
  if (
    normalizeIdentity(await identityMarker.textContent()) !==
    normalizeIdentity(expectedUsername)
  ) {
    return result('surface_changed', 'identity_marker_mismatch', observedAt);
  }
  return result(
    'ready',
    'candidate_resume_identity_verified',
    observedAt,
    'candidate_resume_owner_match',
  );
}

function oneTimeCodeField(page: Page): Locator {
  return page.locator(HH_SELECTORS.security.oneTimeCodeInput).first();
}

function loginError(page: Page): Locator {
  return page.locator(HH_SELECTORS.security.loginError).first();
}

async function challengeVisible(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '');
  return (
    /(captcha|robot|робот|проверка|challenge)/iu.test(title) ||
    (await isVisible(page.locator(HH_SELECTORS.security.captchaContainer), 0))
  );
}

async function isVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) {
    return (await locator.count()) > 0 && locator.first().isVisible();
  }
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Radios that carry the account/credential choice are visually hidden. */
async function isPresent(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * hh.ru renders its choice radios as absolutely-positioned inputs inside a card
 * label, and pre-selects one of them. Respect an existing selection, otherwise
 * drive the card the way a person would.
 */
async function selectRadio(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  const radio = page.locator(selector).first();
  if (!(await isPresent(radio, timeoutMs))) return false;
  if (await radio.isChecked()) return true;
  const card = page.locator(`label:has(${selector})`).first();
  if (await isVisible(card, 0)) {
    await card.click();
  } else {
    await radio.check({ force: true }).catch(() => undefined);
  }
  return radio.isChecked();
}

function isCandidateResumesUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return HH_HOSTS.has(url.hostname) && url.pathname === HH_RESUMES_PATH;
  } catch {
    return false;
  }
}

function normalizeIdentity(value: string | null): string {
  return (value ?? '').trim().toLocaleLowerCase('en-US');
}

function result(
  status: HhBrowserLoginStatus,
  reason: HhBrowserLoginReason,
  observedAt: string,
  identityMarker: HhIdentityMarker | null = null,
): HhBrowserLoginResult {
  return { status, reason, identityMarker, observedAt };
}
