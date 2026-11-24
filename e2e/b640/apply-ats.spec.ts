// B787: отклик на сайте работодателя целиком внутри приложения; команды окна имитируются.
import { expect, test, type Page } from '@playwright/test';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../../src/features/legal/capabilityConsents';
import { installDesktopApiTestBridge } from '../../scripts/desktop-api-test-bridge.mjs';
import { expectGates } from './gates';
import { mockResponses } from './responsesFixture';

const SHOTS = process.env.B640_SHOTS;
const VACANCY = 'v-ats';
const HOST = 'jobs.lever.co';
const FORM_URL = `https://${HOST}/grinkod/1/apply`;
const LETTER = 'Здравствуйте!\n\nЯ вырастила группу разработки с 3 до 9 человек.';

const text = (key: string, label: string) => ({
  key,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
});
const FIELDS = [
  text('id:name', 'Full name'),
  { ...text('id:resume', 'Resume/CV'), kind: 'file', accept: '.pdf' },
  text('id:why', 'Why do you want to work here?'),
  { ...text('id:gdpr', 'I agree to the privacy policy'), kind: 'checkbox' },
];

interface Scenario {
  readonly inApp?: boolean;
  readonly outcome?: 'confirmed' | 'unconfirmed';
  readonly formState?: 'ready' | 'captcha';
  readonly mandate?: boolean;
  readonly channel?: 'lever' | 'site';
}

/** Команды приложения: форма, заполнение, одно нажатие. Наружу ничего не уходит. */
async function installApp(page: Page, scenario: Scenario): Promise<void> {
  await page.addInitScript(installDesktopApiTestBridge);
  await page.addInitScript(
    ({ fields, host, scenario: { outcome = 'confirmed', formState = 'ready' } }) => {
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
      const state = window as unknown as {
        __ats: { command: string; args: unknown }[];
        __TAURI_INTERNALS__: unknown;
      };
      state.__ats = [];
      interface Entry {
        readonly key: string;
        readonly value: string;
        readonly file?: { readonly name: string };
      }
      const answers: Record<string, (args: never) => unknown> = {
        ats_form_open: () => ({
          state: formState,
          adapter: 'lever',
          host,
          form: formState === 'ready' ? { fields, step: 'submit' } : {},
        }),
        ats_form_fill: ({ request }: { request: { entries: readonly Entry[] } }) => ({
          results: Object.fromEntries(request.entries.map(({ key }) => [key, 'set'])),
          values: Object.fromEntries(
            request.entries.map(({ key, value, file }) => [key, file?.name ?? value]),
          ),
        }),
        ats_form_submit: () => ({
          outcome,
          reason: null,
          host,
          path: '/grinkod/1/thanks',
          pressedAtMs: Date.now(),
          fieldKeys: [],
          invalidKeys: [],
        }),
      };
      state.__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: never) => {
          if (command.startsWith('ats_form')) state.__ats.push({ command, args });
          return answers[command]?.(args) ?? null;
        },
      };
    },
    { fields: FIELDS, host: HOST, scenario },
  );
}

const json = (data: unknown, status = 200) => ({ status, json: { data } });

async function mockVacancy(page: Page, { channel = 'lever' }: Scenario): Promise<void> {
  const url = channel === 'lever' ? FORM_URL : 'https://grinkod.example/jobs/1';
  await page.route('**/api/v1/candidate/b640/vacancies/*', (route) =>
    route.fulfill(
      json({
        cluster: {
          id: VACANCY,
          canonicalTitle: 'Head of Engineering',
          canonicalCompany: 'Гринкод',
          primaryUrl: url,
          sources: [],
        },
        explanation: {},
        applyTarget: { channel, url, formUrl: url, origin: 'url' },
      }),
    ),
  );
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill(
      json({
        id: VACANCY,
        description: 'Задачи.',
        truncated: false,
        skills: [],
        responsibilities: [],
      }),
    ),
  );
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals/latest', (route) =>
    route.fulfill(
      json({
        approval: {
          applicationId: 'a-ats',
          documentId: 'letter-1',
          approvedAt: '2026-11-19T10:00:00.000Z',
          status: 'approved',
          sent: false,
          resume: {
            kind: 'general',
            versionId: null,
            documentId: 'cv-1',
            snapshotAt: '2026-11-19T10:00:00.000Z',
          },
          subject: 'Отклик',
          body: LETTER,
          variantId: null,
          factsChanged: false,
          profileChanged: false,
        },
        draft: null,
      }),
    ),
  );
  await page.route('**/api/v1/candidate/documents/cv-1/download', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 e2e') }),
  );
  await page.route('**/api/v1/candidate/resume', (route) =>
    route.fulfill(
      json({
        projection: {
          master: { contact: { fullName: 'Марина Соколова', email: 'm@example.com', links: [] } },
        },
      }),
    ),
  );
}

interface Question {
  readonly id: string;
  readonly required: boolean;
  readonly known?: string;
}

async function mockForm(page: Page, calls: string[]): Promise<void> {
  let questions: readonly Question[] = [];
  let answers: { questionId: string; text: string }[] = [];
  const view = () => ({
    vacancyId: VACANCY,
    state: questions.length > 0 ? 'ready' : 'none',
    formUrl: questions.length > 0 ? FORM_URL : null,
    questions,
    vacancyTitle: 'Head of Engineering',
    vacancyCompany: 'Гринкод',
    answers,
    suggestions: [],
    answered: answers.length,
    total: questions.length,
    missingRequired: 0,
    readAt: null,
    submittedAt: null,
  });
  await page.route('**/api/v1/candidate/vacancies/*/questionnaire**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/ats-form')) {
      questions = (route.request().postDataJSON() as { questions: Question[] }).questions;
      answers = questions.flatMap(({ id, known }) =>
        known ? [{ questionId: id, text: known }] : [],
      );
    } else if (method === 'PUT') {
      answers = (route.request().postDataJSON() as { answers: typeof answers }).answers;
    } else if (method === 'POST') {
      calls.push('form submitted');
      await route.fulfill(json({ submittedAt: new Date().toISOString() }));
      return;
    }
    await route.fulfill(json(view()));
  });
}

async function mockSending(page: Page, calls: string[], scenario: Scenario): Promise<void> {
  let granted = scenario.mandate !== false;
  const versionId = CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf;
  const consent = { capability: 'actions_on_behalf', versionId, revokedAt: null };
  await page.route('**/api/v1/me/consents**', async (route) => {
    if (route.request().method() === 'POST') {
      granted = true;
      calls.push('mandate');
      await route.fulfill(json({ consent }));
      return;
    }
    await route.fulfill(json({ consents: granted ? [consent] : [] }));
  });
  await page.route('**/api/v1/candidate/apply-consents**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path.endsWith('/result') ? 'consent result' : 'consent');
    await route.fulfill(json({}, 201));
  });
  let queued: Record<string, unknown> | null = null;
  await page.route('**/api/v1/candidate/manual-applications**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { reason: string; host: string };
      calls.push(`queue ${body.reason} ${body.host}`);
      queued = {
        vacancyId: VACANCY,
        applicationId: 'a-ats',
        title: 'Head of Engineering',
        company: 'Гринкод',
        url: FORM_URL,
        reason: body.reason,
        host: body.host,
        state: 'ready',
        preparing: false,
        missingAnswers: 0,
        letter: LETTER,
        createdAt: '2026-11-25T10:00:00.000Z',
      };
    }
    if (queued) await route.fulfill(json(queued));
    else await route.fulfill({ status: 404, json: { error: { code: 'not_found', message: '' } } });
  });
  await page.route('**/api/v1/candidate/vacancy-applications**', async (route) => {
    if (route.request().method() === 'POST') calls.push('applied');
    await route.fulfill(json(route.request().method() === 'POST' ? { clusterId: VACANCY } : []));
  });
}

async function open(page: Page, step: string, scenario: Scenario = {}): Promise<string[]> {
  const calls: string[] = [];
  if (scenario.inApp !== false) await installApp(page, scenario);
  await mockResponses(page, {});
  await mockVacancy(page, scenario);
  await mockForm(page, calls);
  await mockSending(page, calls, scenario);
  await page.goto(`/app/responses/${VACANCY}/letter?step=${step}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-b640-node="o02"]')).toBeVisible({ timeout: 15_000 });
  return calls;
}

const commands = (page: Page, name: string) =>
  page.evaluate(
    (command) =>
      (window as unknown as { __ats: { command: string; args: unknown }[] }).__ats.filter(
        (call) => call.command === command,
      ),
    name,
  );
const send = (page: Page) => page.getByRole('button', { name: 'Отправить отклик', exact: true });
const withForm = (page: Page) =>
  page.getByRole('button', { name: 'Отправить отклик с анкетой' }).locator('visible=true');

async function answerQuestion(page: Page): Promise<void> {
  const why = page.getByLabel('Why do you want to work here?');
  await why.fill('Продукт мне близок');
  await why.blur();
}

/** Экран не шире окна до 280 px, кнопки не ниже 44 px, одна главная кнопка. */
async function expectLayout(page: Page): Promise<void> {
  const size = page.viewportSize()!;
  for (const width of [size.width, 320, 280]) {
    await page.setViewportSize({ width, height: size.height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(0);
  }
  await page.setViewportSize(size);
  const main = page.locator('[data-b640-node="o02"]');
  await expect(main.locator('.btn.is-primary').locator('visible=true')).toHaveCount(1);
  if (size.width < 768) {
    for (const button of await main.locator('.actions .btn').locator('visible=true').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
}

const shot = async (page: Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${project}.png`, fullPage: true });
};

test.describe('B787: отклик на сайте работодателя в приложении', () => {
  test('анкета читается, известное стоит, одно нажатие отправляет отклик', async ({
    page,
  }, info) => {
    const calls = await open(page, 'form');
    await expect(page.getByLabel('Full name')).toHaveValue('Марина Соколова');
    await expect(page.getByText('privacy policy')).toHaveCount(0);
    await expect(page.getByText('Вернулись с сайта компании?')).toHaveCount(0);
    await expectLayout(page);
    await expectGates(page);
    await shot(page, 'form', info.project.name);
    await answerQuestion(page);
    await withForm(page).first().click();
    await expect(page.getByText(new RegExp(`^Отправлено .* · ${HOST}$`, 'u'))).toBeVisible();
    await expect(send(page)).toHaveCount(0);
    await expectLayout(page);
    await shot(page, 'sent', info.project.name);
    expect(await commands(page, 'ats_form_submit')).toHaveLength(1);
    const [fill] = await commands(page, 'ats_form_fill');
    expect(JSON.stringify(fill)).toContain('Марина Соколова.pdf');
    expect(await commands(page, 'ats_form_show')).toHaveLength(0);
    expect(calls.indexOf('consent')).toBeLessThan(calls.indexOf('consent result'));
    expect(calls).toContain('applied');
    expect(calls).toContain('form submitted');
  });

  test('«Отправка»: неотвеченный вопрос ведёт в анкету', async ({ page }, info) => {
    await open(page, 'send');
    await expect(page.getByRole('button', { name: 'Ответить · 1 вопрос' })).toBeVisible();
    await expect(send(page)).toHaveCount(0);
    await expectLayout(page);
    await expectGates(page);
    await shot(page, 'send', info.project.name);
    await page.getByRole('button', { name: 'Ответить · 1 вопрос' }).click();
    await expect(page.getByLabel('Why do you want to work here?')).toBeVisible();
  });

  test('поручение спрашивают один раз, затем отклик уходит', async ({ page }) => {
    const calls = await open(page, 'form', { mandate: false });
    await answerQuestion(page);
    await withForm(page).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await commands(page, 'ats_form_submit')).toHaveLength(0);
    await dialog.locator('.btn.is-primary').click();
    await expect(page.getByText(new RegExp(`^Отправлено .* · ${HOST}$`, 'u'))).toBeVisible();
    expect(calls.filter((call) => call === 'mandate')).toHaveLength(1);
  });

  test('без подтверждения второго нажатия нет', async ({ page }, info) => {
    const calls = await open(page, 'form', { outcome: 'unconfirmed' });
    await answerQuestion(page);
    await withForm(page).first().click();
    await expect(page.getByText(`${HOST} не подтвердил отклик.`)).toBeVisible();
    await expect(send(page)).toHaveCount(0);
    await shot(page, 'unconfirmed', info.project.name);
    expect(calls).not.toContain('applied');
    expect(calls.some((call) => call.startsWith('queue'))).toBe(false);
  });

  test('капча до нажатия: отклик в очереди, всё готово для копирования', async ({ page }) => {
    const calls = await open(page, 'send', { formState: 'captcha' });
    await expect.poll(() => calls).toContain(`queue captcha ${HOST}`);
    await expect(page.getByRole('button', { name: 'Скопировать' }).first()).toBeVisible();
    expect(await commands(page, 'ats_form_submit')).toHaveLength(0);
  });

  test('сайт вне списка и веб: отклик встаёт в очередь', async ({ page }) => {
    const calls = await open(page, 'send', { inApp: false, channel: 'site' });
    await expect.poll(() => calls).toContain('queue other grinkod.example');
    await expect(page.getByRole('button', { name: 'Скопировать' }).first()).toBeVisible();
  });
});
