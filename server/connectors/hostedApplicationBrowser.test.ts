import { readFile } from 'node:fs/promises';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorHarness } from './connectorHarness';
import { HostedApplicationBrowserExecutor } from './hostedApplicationBrowser';

const fixtureUrl = new URL('./fixtures/syntheticHostedApplication.html', import.meta.url);
const request = {
  idempotencyKey: '8463f97d-8539-42ea-8774-c79d6dd417f2',
  opportunityId: 'synthetic-opportunity-001',
  action: 'application' as const,
  payload: {
    fullName: 'Synthetic Candidate',
    email: 'candidate@example.test',
    coverNote: 'Synthetic fixture only.',
  },
};

describe('hosted application browser executor', { timeout: 30_000 }, () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30_000);

  it('submits a synthetic hosted form once and emits a normalized receipt', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });
    const { page } = session;
    await page.setContent(await readFile(fixtureUrl, 'utf8'));
    const harness = new ConnectorHarness({
      executor: session.executor,
      maxActions: 1,
    });

    const first = await harness.execute(request);
    const duplicate = await harness.execute(request);

    expect(first).toEqual({
      connectorId: 'synthetic-hosted-form',
      transport: 'browser_session',
      action: 'application',
      status: 'completed',
      idempotencyKey: request.idempotencyKey,
      opportunityId: request.opportunityId,
      providerReference: 'synthetic-application-001',
      evidence: {
        kind: 'dom_confirmation',
        observedAt: '2026-08-06T12:00:00.000Z',
      },
    });
    expect(duplicate).toEqual(first);
    expect(await page.locator('body').getAttribute('data-submission-count')).toBe('1');
    await session.close();
  });

  it('pauses without clicking when a challenge replaces the expected form', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });
    const { page } = session;
    await page.setContent('<main><h1>Verify you are human</h1><button>Continue</button></main>');
    const harness = new ConnectorHarness({
      executor: session.executor,
      maxActions: 1,
    });

    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      evidence: null,
      diagnostic: {
        reason: 'challenge_detected',
        surfaceState: 'challenge',
      },
    });
    expect(harness.state().status).toBe('paused');
    await session.close();
  });

  it('rejects a browser context that already contains session cookies', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });
    await session.context.addCookies([
      {
        name: 'synthetic_session',
        value: 'fixture-not-a-real-secret',
        domain: 'synthetic.test',
        path: '/',
      },
    ]);
    const { page } = session;
    await page.setContent(await readFile(fixtureUrl, 'utf8'));
    const harness = new ConnectorHarness({
      executor: session.executor,
      maxActions: 1,
    });

    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'session_not_ephemeral' },
    });
    expect(await page.locator('body').getAttribute('data-submission-count')).toBeNull();
    await session.close();
  });

  it('rejects local or session storage added to the fresh context', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });
    await session.page.route('https://synthetic.test/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: await readFile(fixtureUrl, 'utf8'),
      });
    });
    await session.page.goto('https://synthetic.test/application');
    await session.page.evaluate(() => localStorage.setItem('auth_state', 'synthetic'));
    const harness = new ConnectorHarness({ executor: session.executor, maxActions: 1 });

    expect(await harness.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'session_not_ephemeral' },
    });
    expect(
      await session.page.locator('body').getAttribute('data-submission-count'),
    ).toBeNull();
    await session.close();
  });

  it('pauses unsupported actions and invalid payloads before form mutation', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
    });
    const { page } = session;
    await page.setContent(await readFile(fixtureUrl, 'utf8'));
    const { executor } = session;

    expect(
      await executor.execute({ ...request, action: 'message' }),
    ).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'action_not_supported' },
    });
    expect(
      await executor.execute({ ...request, payload: { email: 'not-an-email' } }),
    ).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'application_payload_invalid' },
    });
    expect(await page.locator('body').getAttribute('data-submission-count')).toBeNull();
    await session.close();
  });

  it('pauses when required semantic roles or provider confirmation are absent', async () => {
    const session = await HostedApplicationBrowserExecutor.create(browser, {
      connectorId: 'synthetic-hosted-form',
      observedAt: () => '2026-08-06T12:00:00.000Z',
      interactionTimeoutMs: 5_000,
      timeoutMs: 500,
    });
    const { page, executor } = session;

    await page.setContent('<main><h1>Application</h1></main>');
    expect(await executor.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'unexpected_surface' },
    });

    await page.setContent(`
      <form aria-label="Job application">
        <label>Full name<input /></label>
        <label>Email<input type="email" /></label>
        <button type="submit">Submit application</button>
      </form>
      <script>document.querySelector('form').onsubmit = event => event.preventDefault()</script>
    `);
    expect(await executor.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'confirmation_missing',
        surfaceFingerprint: 'status-not-visible',
      },
    });

    await page.setContent(`
      <form aria-label="Job application">
        <label>Full name<input /></label>
        <label>Email<input type="email" /></label>
        <button type="submit">Submit application</button>
      </form>
      <p role="status" hidden></p>
      <script>
        document.querySelector('form').onsubmit = event => {
          event.preventDefault();
          const status = document.querySelector('[role=status]');
          status.hidden = false;
          status.textContent = 'Application received';
        };
      </script>
    `);
    expect(await executor.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'confirmation_missing',
        surfaceFingerprint: 'provider-reference-missing',
      },
    });

    await page.setContent(`
      <form aria-label="Job application">
        <label>Full name<input /></label>
        <label>Email<input type="email" /></label>
        <button type="submit" disabled>Submit application</button>
      </form>
    `);
    expect(await executor.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'interaction_failed',
        surfaceFingerprint: 'semantic-action-failed',
      },
    });

    await page.setContent(`
      <form aria-label="Job application">
        <label>Full name<input /></label>
        <label>Email<input type="email" /></label>
        <button type="submit">Submit application</button>
      </form>
      <p role="status" hidden></p>
      <script>
        document.querySelector('form').onsubmit = event => {
          event.preventDefault();
          const status = document.querySelector('[role=status]');
          status.hidden = false;
          status.textContent = 'Application received';
          status.dataset.applicationId = 'candidate@example.test';
        };
      </script>
    `);
    expect(await executor.execute(request)).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'confirmation_invalid',
        surfaceFingerprint: 'provider-reference-invalid',
      },
    });
    await session.close();
  });
});
