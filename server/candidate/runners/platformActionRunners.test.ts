import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { HhActionRunner } from './HhActionRunner';
import { LinkedinEasyApplyRunner } from './LinkedinEasyApplyRunner';
import type { CandidateActionItem, CandidateActionSession } from '../candidateActionExecutor';

const candidateId = 'cand-test';
const fixtureDirectory = new URL('./fixtures/', import.meta.url);
let browser: Browser;
let page: Page;
let context: BrowserContext;
let hhApplication: string;
let hhResume: string;
let linkedinApplication: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  hhApplication = await readFile(new URL('hh-application.html', fixtureDirectory), 'utf8');
  hhResume = await readFile(new URL('hh-resume.html', fixtureDirectory), 'utf8');
  linkedinApplication = await readFile(new URL('linkedin-easy-apply.html', fixtureDirectory), 'utf8');
});

afterEach(async () => {
  await context?.close();
});

afterAll(async () => {
  await browser?.close();
});

async function openPage(
  platform: 'hh' | 'linkedin',
  fixture: string,
  status = 200,
): Promise<CandidateActionSession> {
  context = await browser.newContext();
  const origin = platform === 'hh' ? 'https://hh.ru' : 'https://www.linkedin.com';
  await context.route(`${origin}/**`, (route) =>
    route.fulfill({ status, contentType: 'text/html', body: fixture }),
  );
  page = await context.newPage();
  return { candidateId, platform, page };
}

function action(overrides: Partial<CandidateActionItem> = {}): CandidateActionItem {
  return {
    id: 'action-1',
    platform: 'hh',
    actionKind: 'hh_apply',
    targetUrl: 'https://hh.ru/vacancy/123',
    resumeId: 'resume-1',
    letterText: 'Здравствуйте. Меня заинтересовала вакансия.',
    ...overrides,
  };
}

describe('platform action runners use only fixture pages and stop on unsafe surfaces', { timeout: 30_000 }, () => {
  it('sends the approved hh.ru letter and reports delivery only from the success reference', async () => {
    const session = await openPage('hh', hhApplication);
    const result = await new HhActionRunner().run(action(), session);

    expect(result).toEqual({ status: 'delivered', providerStatus: 'hh_response_submitted' });
    expect(await page.locator('#letter').inputValue()).toBe('Здравствуйте. Меня заинтересовала вакансия.');
    expect(await page.locator('input[name="resume"]').isChecked()).toBe(true);
    expect(await page.evaluate(() => (window as Window & { syntheticSubmitted?: boolean }).syntheticSubmitted)).toBe(true);
  });

  it('stops before an hh.ru click on a CAPTCHA surface', async () => {
    const challenge = '<!doctype html><title>Security check</title><main>CAPTCHA required</main>';
    const session = await openPage('hh', challenge);
    const result = await new HhActionRunner().run(action(), session);

    expect(result).toEqual({ status: 'failed', failureCode: 'challenge_required' });
  });

  it('stops before an hh.ru click when the provider returns 403', async () => {
    const session = await openPage('hh', '<!doctype html><title>Forbidden</title>', 403);
    const result = await new HhActionRunner().run(action(), session);

    expect(result).toEqual({ status: 'failed', failureCode: 'http_403' });
  });

  it('counts a click without a provider confirmation as attempted and does not click again', async () => {
    const unconfirmed = hhApplication.replace(
      "document.querySelector('#success').hidden = false;",
      "window.syntheticClickCount = (window.syntheticClickCount || 0) + 1;",
    );
    const session = await openPage('hh', unconfirmed);
    const result = await new HhActionRunner().run(action(), session);

    expect(result).toEqual({ status: 'attempted', failureCode: 'provider_confirmation_missing' });
    expect(await page.evaluate(() => (window as Window & { syntheticClickCount?: number }).syntheticClickCount)).toBe(1);
  });

  it('updates only the selected hh.ru resume after the date changes', async () => {
    const session = await openPage('hh', hhResume);
    const result = await new HhActionRunner().run(action({
      actionKind: 'hh_resume_boost',
      targetUrl: 'https://hh.ru/applicant/resumes',
      letterText: null,
    }), session);

    expect(result).toEqual({ status: 'delivered', providerStatus: 'hh_resume_updated' });
    expect(await page.locator('#next').innerText()).toBe('Действует до завтра');
  });

  it('submits LinkedIn Easy Apply after known required fields are filled and confirmed', async () => {
    const session = await openPage('linkedin', linkedinApplication);
    const result = await new LinkedinEasyApplyRunner().run(action({
      platform: 'linkedin',
      actionKind: 'linkedin_easy_apply',
      targetUrl: 'https://www.linkedin.com/jobs/view/123',
    }), session);

    expect(result).toEqual({ status: 'delivered', providerStatus: 'linkedin_application_submitted' });
    expect(await page.locator('#letter').inputValue()).toBe('Здравствуйте. Меня заинтересовала вакансия.');
    expect(await page.evaluate(() => (window as Window & { syntheticSubmitted?: boolean }).syntheticSubmitted)).toBe(true);
  });

  it('stops before LinkedIn submission when a required candidate answer is missing', async () => {
    const blankRequired = linkedinApplication.replace('value="+10000000000"', 'value=""');
    const session = await openPage('linkedin', blankRequired);
    const result = await new LinkedinEasyApplyRunner().run(action({
      platform: 'linkedin',
      actionKind: 'linkedin_easy_apply',
      targetUrl: 'https://www.linkedin.com/jobs/view/123',
    }), session);

    expect(result).toEqual({ status: 'failed', failureCode: 'candidate_input_required' });
    expect(await page.evaluate(() => (window as Window & { syntheticSubmitted?: boolean }).syntheticSubmitted ?? false)).toBe(false);
  });

  it('stops on a LinkedIn security challenge without opening Easy Apply', async () => {
    const challenge = '<!doctype html><title>Security check</title><main>Verify you are human</main>';
    const session = await openPage('linkedin', challenge);
    const result = await new LinkedinEasyApplyRunner().run(action({
      platform: 'linkedin',
      actionKind: 'linkedin_easy_apply',
      targetUrl: 'https://www.linkedin.com/jobs/view/123',
    }), session);

    expect(result).toEqual({ status: 'failed', failureCode: 'challenge_required' });
  });

  it('blocks an off-domain redirect before the browser requests its destination', async () => {
    let offDomainRequests = 0;
    context = await browser.newContext();
    await context.route('https://www.linkedin.com/jobs/view/123', (route) =>
      route.fulfill({ status: 302, headers: { location: 'https://evil.example/login' }, body: '' }),
    );
    await context.route('https://evil.example/**', (route) => {
      offDomainRequests += 1;
      return route.fulfill({ status: 200, body: 'blocked test fixture' });
    });
    page = await context.newPage();
    const session: CandidateActionSession = { candidateId, platform: 'linkedin', page };
    const result = await new LinkedinEasyApplyRunner().run(action({
      platform: 'linkedin',
      actionKind: 'linkedin_easy_apply',
      targetUrl: 'https://www.linkedin.com/jobs/view/123',
    }), session);

    expect(result.status).toBe('failed');
    expect(offDomainRequests).toBe(0);
  });

  it('refuses an unapproved host even when the session is authenticated', async () => {
    const session = await openPage('hh', hhApplication);
    const result = await new HhActionRunner().run(action({ targetUrl: 'https://not-hh.ru/vacancy/123' }), session);

    expect(result).toEqual({ status: 'failed', failureCode: 'target_not_allowed' });
    expect(page.url()).toBe('about:blank');
  });
});
