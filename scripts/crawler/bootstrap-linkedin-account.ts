#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnvironmentFile } from '../../server/connectors/hh/hhTestAccountEnvironment';
import { resolveLocalEnvironmentFilePath } from '../../server/localEnvironmentFile';
import { linkedinCredentialBlock } from '../../server/crawler/linkedinAccountConfig';
import { linkedinProviderCapability } from '../../server/crawler/linkedinProviderCapability';
import { ObscuraRunner } from '../../server/crawler/obscuraRunner';
import { resolveLinkedinProxyUrl } from '../../server/crawler/linkedinScraper';

const DEFAULT_POOL_ROOT = path.resolve(process.cwd(), 'data/crawlers/linkedin');

function loadLocalEnv(): void {
  const envPath = resolveLocalEnvironmentFilePath();
  if (!fs.existsSync(envPath)) throw new Error(`linkedin_env_missing: ${envPath}`);
  const parsed = parseEnvironmentFile(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function accountArg(): string {
  const index = process.argv.indexOf('--account');
  return (index >= 0 ? process.argv[index + 1] : undefined) ?? 'account-1';
}

function useDirectTransport(): boolean {
  return process.argv.includes('--direct');
}

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('linkedin_2fa_key_invalid');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function makeTotp(secret: string, nowMs = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

function loginEval(login: string, password: string): string {
  return `
    (async () => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) return 'missing';
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled';
      };
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons.find((candidate) => /^(sign in|войти)$/i.test(candidate.textContent?.trim() ?? ''))
        ?? buttons.find((candidate) => /sign in|войти/i.test(candidate.textContent?.trim() ?? ''));
      const usernameResult = setValue('input[autocomplete="username"], input[type="email"]', ${JSON.stringify(login)});
      const passwordResult = setValue('input[autocomplete="current-password"], input[type="password"]', ${JSON.stringify(password)});
      const buttonResult = button ? (button.click(), 'clicked') : 'button_missing';
      await new Promise((resolve) => setTimeout(resolve, 7000));
      return JSON.stringify({ usernameResult, passwordResult, buttonResult, href: location.href });
    })()
  `;
}

function otpEval(code: string): string {
  return `
    (async () => {
      const input = document.querySelector('input[autocomplete="one-time-code"], input[name*="pin"], input[name*="code"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(code)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const button = [...document.querySelectorAll('button')].find((candidate) => /verify|continue|submit|next|подтвердить|продолжить/i.test(candidate.textContent?.trim() ?? ''));
      const buttonResult = button ? (button.click(), 'clicked') : 'button_missing';
      await new Promise((resolve) => setTimeout(resolve, 7000));
      return JSON.stringify({ codeResult: input ? 'filled' : 'missing', buttonResult, href: location.href });
    })()
  `;
}

function hasChallenge(html: string): boolean {
  return /checkpoint(?:\/|\b)|security verification|quick-verification|verify your identity|<input[^>]+(?:captcha|challenge|verification)/i.test(
    html,
  );
}

function hasOtpPrompt(html: string): boolean {
  return /autocomplete=["']one-time-code|name=["'][^"']*(?:pin|otp|verification)[^"']*["']|enter (?:the )?code|two-factor/i.test(
    html,
  );
}

function looksSignedIn(html: string): boolean {
  return !/<input[^>]+autocomplete=["']username/i.test(html) &&
    !/<input[^>]+autocomplete=["']current-password/i.test(html) &&
    !/LinkedIn Login, Sign in/i.test(html);
}

// eslint-disable-next-line max-lines-per-function
async function main(): Promise<void> {
  loadLocalEnv();
  if (linkedinProviderCapability().verdict === 'not_configured') {
    throw new Error('provider_permission_required: LinkedIn bootstrap is disabled until an official/provider-permitted capability is recorded');
  }
  const accountId = accountArg();
  const credentials = linkedinCredentialBlock(accountId);
  if (!credentials.login || !credentials.password) {
    throw new Error(`linkedin_credentials_missing: ${accountId}`);
  }

  const storagePath = path.join(DEFAULT_POOL_ROOT, accountId);
  fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(storagePath, 0o700);
  } catch {
    // Best effort on filesystems that do not expose POSIX modes.
  }

  const runner = new ObscuraRunner({
    userDataDir: storagePath,
    headless: true,
    proxyUrl: useDirectTransport() ? undefined : resolveLinkedinProxyUrl(),
  });
  let stage = 'login';
  let loginHtml = '';
  let loginSlot = 'login';
  const loginCandidates = [
    { slot: 'login', value: credentials.login },
    ...(credentials.emailLogin && credentials.emailLogin !== credentials.login
      ? [{ slot: 'email_login', value: credentials.emailLogin }]
      : []),
  ];
  for (const candidate of loginCandidates) {
    loginSlot = candidate.slot;
    stage = `login_${candidate.slot}`;
    try {
      loginHtml = await runner.fetchHtml('https://www.linkedin.com/login', {
        timeoutMs: 60_000,
        evalScript: loginEval(candidate.value!, credentials.password),
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      const signal = typeof error === 'object' && error !== null && 'signal' in error ? String(error.signal) : 'none';
      throw new Error(`linkedin_bootstrap_failed_stage_${stage}_code_${code}_signal_${signal}`);
    }
    const loginFormVisible = /autocomplete=["']username|autocomplete=["']current-password/i.test(loginHtml);
    const loginRejected = /incorrect|unable to sign in|try again|wrong password|invalid password/i.test(loginHtml);
    const otpPrompt = hasOtpPrompt(loginHtml);
    console.log(JSON.stringify({ phase: 'login_result', slot: candidate.slot, loginFormVisible, loginRejected, otpPrompt }));
    if (!loginFormVisible || !loginRejected || otpPrompt) break;
  }

  const loginFormVisible = /autocomplete=["']username|autocomplete=["']current-password/i.test(loginHtml);
  const loginRejected = /incorrect|unable to sign in|try again|wrong password|invalid password/i.test(loginHtml);
  const otpPrompt = hasOtpPrompt(loginHtml);
  if (loginFormVisible && loginRejected) {
    throw new Error(`linkedin_login_rejected_${loginSlot}`);
  }

  let otpUsed = false;
  if (otpPrompt && credentials.twoFactorKey) {
    otpUsed = true;
    stage = 'otp';
    let otpHtml: string;
    try {
      otpHtml = await runner.fetchHtml('https://www.linkedin.com/login', {
        timeoutMs: 60_000,
        evalScript: otpEval(makeTotp(credentials.twoFactorKey)),
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
      const signal = typeof error === 'object' && error !== null && 'signal' in error ? String(error.signal) : 'none';
      throw new Error(`linkedin_bootstrap_failed_stage_${stage}_code_${code}_signal_${signal}`);
    }
    if (hasChallenge(otpHtml)) {
      throw new Error('linkedin_checkpoint_or_2fa_still_required');
    }
  }

  stage = 'feed';
  let feedHtml: string;
  let cookies;
  try {
    feedHtml = await runner.fetchHtml('https://www.linkedin.com/feed/', { timeoutMs: 60_000 });
    cookies = await runner.fetchCookies('https://www.linkedin.com/feed/', { timeoutMs: 30_000 });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
    const signal = typeof error === 'object' && error !== null && 'signal' in error ? String(error.signal) : 'none';
    throw new Error(`linkedin_bootstrap_failed_stage_${stage}_code_${code}_signal_${signal}`);
  }
  const signedIn = looksSignedIn(feedHtml);
  console.log(
    JSON.stringify({
      accountId,
      storagePath,
      signedIn,
      otpUsed,
      challenge: hasChallenge(feedHtml),
      sessionCookieCount: cookies.length,
    }),
  );
  if (!signedIn || hasChallenge(feedHtml)) {
    throw new Error('linkedin_session_not_confirmed');
  }
}

main().catch((error) => {
  // Never print the child command: it contains the evaluated login script and
  // may contain proxy credentials in its argument list.
  const code = error instanceof Error && /checkpoint|2fa|session_not_confirmed|login_rejected|failed_stage_/i.test(error.message)
    ? error.message
    : 'linkedin_bootstrap_transport_failed';
  console.error(code);
  process.exitCode = 1;
});
