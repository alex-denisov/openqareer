import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect as expectPage } from '@playwright/test';
import type { ConnectorRequest } from '../connectorHarness';
import { HhApplicationBrowserSession } from './hhApplicationBrowser';

describe('hh.ru candidate-scoped application browser session', { timeout: 15_000 }, () => {
  const fixedNow = '2026-08-14T15:00:00.000Z';
  const candidateId = '11111111-1111-4111-8111-111111111111';
  const fixtureUrl = new URL('./fixtures/syntheticApplication.html', import.meta.url);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let fixture: string;

  beforeAll(async () => {
    fixture = await readFile(fixtureUrl, 'utf8');
    browser = await chromium.launch({ headless: true });
  });

  afterEach(async () => {
    await context?.close();
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function createSession(html = fixture) {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route('https://hh.ru/vacancy/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    return new HhApplicationBrowserSession({
      candidateId,
      page,
      now: () => fixedNow,
    });
  }

  function request(
    overrides: Partial<ConnectorRequest> = {},
  ): ConnectorRequest {
    return {
      candidateId,
      action: 'application',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      opportunityId: 'hh:vacancy:123456789',
      payload: {
        commandId: '00000000-0000-4000-8000-000000000001',
        capability: 'application.submit',
        approvalId: '10000000-0000-4000-8000-000000000001',
        executionTarget: {
          platform: 'hh',
          vacancyId: '123456789',
          resumeId: 'synthetic-resume-1',
          message: 'Подтверждённый кандидатом текст.',
        },
      },
      ...overrides,
    };
  }

  it('submits only the exact approved vacancy, resume and message', async () => {
    const session = await createSession();

    const receipt = await session.execute(request());

    expect(receipt).toEqual({
      connectorId: 'hh-browser-session',
      transport: 'browser_session',
      action: 'application',
      status: 'completed',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      opportunityId: 'hh:vacancy:123456789',
      providerReference: 'synthetic-response-42',
      evidence: { kind: 'dom_confirmation', observedAt: fixedNow },
    });
    await expectPage(
      page.locator('[data-resume-id="synthetic-resume-1"] input'),
    ).toBeChecked();
    await expectPage(
      page.locator('[data-qa="vacancy-response-popup__letter-textarea"]'),
    ).toHaveValue('Подтверждённый кандидатом текст.');
    expect(await page.evaluate(() => window.syntheticSubmitted)).toBe(true);
  });

  it('does not navigate or click without the server approval binding', async () => {
    const session = await createSession();
    const invalid = request({
      payload: {
        commandId: '00000000-0000-4000-8000-000000000001',
        capability: 'application.submit',
        executionTarget: {
          platform: 'hh',
          vacancyId: '123456789',
          resumeId: 'synthetic-resume-1',
        },
      },
    });

    const receipt = await session.execute(invalid);

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_approval_binding_invalid' },
    });
    expect(page.url()).toBe('about:blank');
  });

  it('rejects a different candidate before touching the browser session', async () => {
    const session = await createSession();

    const receipt = await session.execute(
      request({ candidateId: '22222222-2222-4222-8222-222222222222' }),
    );

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_candidate_session_mismatch' },
    });
    expect(page.url()).toBe('about:blank');
  });

  it('pauses before submit when hh.ru presents an employer questionnaire', async () => {
    const questionnaire = fixture.replace(
      '<button data-qa="vacancy-response-submit-popup"',
      '<p data-qa="vacancy-response-questionnaire">Нужна анкета</p><button data-qa="vacancy-response-submit-popup"',
    );
    const session = await createSession(questionnaire);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_questionnaire_required',
        surfaceState: 'unexpected',
      },
    });
    expect(await page.evaluate(() => window.syntheticSubmitted ?? false)).toBe(false);
  });

  it('pauses on a robot challenge without attempting an application', async () => {
    const challenge = '<!doctype html><title>Подтвердите, что вы не робот</title><div data-qa="captcha">captcha</div>';
    const session = await createSession(challenge);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'challenge_required', surfaceState: 'challenge' },
    });
  });

  it('refuses to act on a page that shows no signed-in applicant', async () => {
    const signedOut = fixture.replace(
      '<a data-qa="mainmenu_applicantProfile" href="/applicant/resumes">Мои резюме</a>',
      '<a href="/account/login">Войти</a>',
    );
    const session = await createSession(signedOut);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_session_identity_unverified',
        surfaceState: 'session_state',
      },
    });
    expect(await page.evaluate(() => window.syntheticApplyOpened ?? false)).toBe(
      false,
    );
  });

  it('does not re-apply when hh.ru already shows an application for this vacancy', async () => {
    const alreadyApplied = fixture.replace(
      '<main>',
      '<main><p data-qa="vacancy-response-already-applied">Вы уже откликнулись</p>',
    );
    const session = await createSession(alreadyApplied);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_already_applied_unverified',
        surfaceState: 'confirmation_missing',
      },
    });
    expect(await page.evaluate(() => window.syntheticSubmitted ?? false)).toBe(
      false,
    );
  });

  it('pauses when the response action is missing from the vacancy surface', async () => {
    const noResponse = fixture.replace(
      'data-qa="vacancy-response-link-top"',
      'data-qa="vacancy-response-link-removed"',
    );
    const session = await createSession(noResponse);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_response_action_missing' },
    });
  });

  it('refuses to substitute another resume when the approved one is absent', async () => {
    const session = await createSession();

    const receipt = await session.execute(
      request({
        payload: {
          commandId: '00000000-0000-4000-8000-000000000001',
          capability: 'application.submit',
          approvalId: '10000000-0000-4000-8000-000000000001',
          executionTarget: {
            platform: 'hh',
            vacancyId: '123456789',
            resumeId: 'not-the-approved-resume',
          },
        },
      }),
    );

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_resume_target_missing' },
    });
    expect(await page.evaluate(() => window.syntheticSubmitted ?? false)).toBe(
      false,
    );
  });

  it('pauses when the approved message has nowhere to go', async () => {
    const noLetter = fixture
      .replace('data-qa="vacancy-response-popup__letter-textarea"', 'data-qa="letter-removed"')
      .replace('data-qa="vacancy-response-popup__letter-toggle"', 'data-qa="toggle-removed"');
    const session = await createSession(noLetter);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_message_field_missing' },
    });
    expect(await page.evaluate(() => window.syntheticSubmitted ?? false)).toBe(
      false,
    );
  });

  it('pauses when the submit action disappears before dispatch', async () => {
    const noSubmit = fixture.replace(
      'data-qa="vacancy-response-submit-popup"',
      'data-qa="submit-removed"',
    );
    const session = await createSession(noSubmit);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_submit_action_missing' },
    });
  });

  it('pauses when the vacancy page cannot be reached at all', async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route('https://hh.ru/vacancy/**', async (route) => {
      await route.abort('connectionfailed');
    });
    const session = new HhApplicationBrowserSession({
      candidateId,
      page,
      now: () => fixedNow,
    });

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_navigation_failed' },
    });
  });

  it('pauses when hh.ru redirects the approved vacancy elsewhere', async () => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.route('https://hh.ru/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/vacancy/123456789') {
        await route.fulfill({
          status: 302,
          headers: { location: 'https://hh.ru/search/vacancy' },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture,
      });
    });
    const session = new HhApplicationBrowserSession({
      candidateId,
      page,
      now: () => fixedNow,
    });

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: { reason: 'hh_target_mismatch' },
    });
  }, 30000);

  it('never reports completion without a bounded DOM confirmation reference', async () => {
    const noReference = fixture.replace(' data-response-id="synthetic-response-42"', '');
    const session = await createSession(noReference);

    const receipt = await session.execute(request());

    expect(receipt).toMatchObject({
      status: 'paused',
      diagnostic: {
        reason: 'hh_confirmation_missing',
        surfaceState: 'confirmation_missing',
      },
    });
  });
});

declare global {
  interface Window {
    syntheticApplyOpened?: boolean;
    syntheticSubmitted?: boolean;
  }
}
