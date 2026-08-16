/**
 * B120/B123 live evidence gate for the hh.ru connector (B130).
 *
 * Runs exactly one read-only sequence against the dedicated test account:
 * sign in, confirm the candidate resume surface belongs to that account and
 * list every resume hh.ru shows for it. It never applies to a vacancy, never
 * publishes a resume, never persists storage state and never prints a
 * credential. A CAPTCHA or one-time-code prompt is reported as a stop for the
 * owner to handle by hand.
 *
 * `OPENQAREER_HH_TEST_RESUME_ID` (optional, not a secret) binds the run to one
 * exact account: without it the gate can only prove "some signed-in applicant".
 *
 *   npm run verify:hh-test-account
 *   npm run verify:hh-test-account -- --headed
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { verifyHhTestAccount } from '../server/connectors/hh/hhBrowserLogin';
import { resolveHhTestAccountEnvironment } from '../server/connectors/hh/hhTestAccountEnvironment';

const headed = process.argv.includes('--headed');
const environmentFile = resolve(process.cwd(), 'openqareer.env');
const fileContents = await readFile(environmentFile, 'utf8').catch(() => null);
const environment = resolveHhTestAccountEnvironment(process.env, fileContents);

if (
  !environment.OPENQAREER_HH_TEST_USERNAME ||
  !environment.OPENQAREER_HH_TEST_PASSWORD
) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'invalid',
        reason: 'credential_environment_missing',
        identityMarker: null,
        resumes: [],
        observedAt: new Date().toISOString(),
        hint: 'set OPENQAREER_HH_TEST_USERNAME / OPENQAREER_HH_TEST_PASSWORD in the environment or openqareer.env',
      },
      null,
      2,
    )}\n`,
  );
  process.exit(2);
}

const browser = await chromium.launch({ headless: !headed });
try {
  const result = await verifyHhTestAccount(browser, { environment });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === 'ready' ? 0 : 1);
} finally {
  await browser.close();
}
