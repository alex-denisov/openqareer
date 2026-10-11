import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

type ConnectionMode = 'rich' | 'none' | 'error' | 'slow';
type PitchMode = 'rich' | 'few' | 'english' | 'error' | 'slow';

interface PitchRequestBody {
  readonly tone?: string;
  readonly language?: string;
  readonly recipient?: { readonly name?: string };
  readonly excludedEvidenceIds?: readonly string[];
}

interface LetterRouteState {
  connectionMode: ConnectionMode;
  pitchMode: PitchMode;
  pendingConnection: Route | null;
  pendingPitch: Route | null;
  pitchBodies: PitchRequestBody[];
  approvedBody: Record<string, unknown> | null;
  sendAttempts: string[];
}

const EVIDENCE_DIR = join(process.cwd(), 'test-results', 'B449');
const FACT_ID = 'fact-platform-delivery';
const WORKPLACE_ID = 'work-platform';

function createRouteState(
  connectionMode: ConnectionMode = 'rich',
  pitchMode: PitchMode = 'rich',
): LetterRouteState {
  return {
    connectionMode,
    pitchMode,
    pendingConnection: null,
    pendingPitch: null,
    pitchBodies: [],
    approvedBody: null,
    sendAttempts: [],
  };
}

function connectionPath(
  id: string,
  circle: 1 | 2 | 3,
  recipient: { id: string; fullName: string; roleTitle: string | null; companyName: string | null },
  path: readonly {
    id: string;
    fullName: string;
    roleTitle: string | null;
    companyName: string | null;
  }[],
  nextStep: 'write_known_contact' | 'ask_for_introduction' | 'cold_application',
) {
  return {
    id,
    circle,
    recipient,
    path,
    evidence: circle === 3 ? [] : ['Связь подтверждена в профиле кандидата'],
    strength: circle === 1 ? 'direct' : circle === 2 ? 'strong' : 'unknown',
    source: circle === 3 ? 'cold' : 'manual',
    nextStep,
  };
}

function connectionResponse(vacancyId: string, mode: ConnectionMode) {
  const colleague = {
    id: 'person-colleague',
    fullName: 'Мария Крылова',
    roleTitle: 'Директор по продукту',
    companyName: 'Genetec',
  };
  const recruiter = {
    id: 'person-recruiting-team',
    fullName: 'Команда найма',
    roleTitle: 'Подбор руководителей',
    companyName: 'Genetec',
  };
  const noDirectContacts = mode === 'none';
  return {
    data: {
      vacancyId,
      companyKey: 'genetec',
      companyName: 'Genetec',
      vacancyTitle: 'Business Information Architect',
      circles: [
        {
          circle: 1,
          state: noDirectContacts ? 'none' : 'available',
          message: noDirectContacts
            ? 'В доступных кандидатских связях знакомых не найдено.'
            : 'Есть знакомые в компании.',
          paths: noDirectContacts
            ? []
            : [
                connectionPath('direct-maria', 1, colleague, [], 'write_known_contact'),
                connectionPath(
                  'direct-anatoly',
                  1,
                  { ...colleague, id: 'person-anatoly', fullName: 'Анатолий Волков' },
                  [],
                  'write_known_contact',
                ),
              ],
        },
        {
          circle: 2,
          state: 'available',
          message: 'Можно попросить представить через знакомого.',
          paths: [connectionPath('intro-maria', 2, recruiter, [colleague], 'ask_for_introduction')],
        },
        {
          circle: 3,
          state: 'available',
          message: 'Подготовьте холодный отклик по вакансии.',
          paths: [connectionPath('cold-team', 3, recruiter, [], 'cold_application')],
        },
      ],
      linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
    },
  };
}

function pitchResponse(vacancyId: string, mode: PitchMode, request: PitchRequestBody) {
  const excluded = request.excludedEvidenceIds ?? [];
  const fewFacts = mode === 'few' || excluded.includes(FACT_ID);
  const language = mode === 'english' || request.language === 'en' ? 'en' : 'ru';
  return {
    data: {
      vacancyId,
      emailPitch: {
        subject: 'О роли в Genetec',
        body: 'Пишу по поводу роли Business Information Architect.',
      },
      linkedInNote: 'Короткое сообщение по вакансии.',
      atsCoverLetter: 'Письмо на основе подтверждённого опыта кандидата.',
      contactMessage: 'Мария, здравствуйте. Пишу по поводу роли в Genetec.',
      usedEvidenceIds: fewFacts ? [] : [FACT_ID],
      candidateWorkplaces: [
        {
          id: WORKPLACE_ID,
          employer: 'Платформенные решения',
          title: 'Руководитель разработки',
          startDate: '2021',
          endDate: null,
          current: true,
          evidenceIds: [FACT_ID],
        },
      ],
      language,
      notices: fewFacts ? ['В профиле мало подтверждённых фактов.'] : [],
      generatedAt: '2026-10-10T12:00:00.000Z',
    },
  };
}

async function installConnectionRoute(page: Page, state: LetterRouteState): Promise<void> {
  await page.route('**/api/v1/candidate/vacancies/*/connection-circles', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (state.connectionMode === 'slow') {
      state.pendingConnection = route;
      return;
    }
    if (state.connectionMode === 'error') {
      return route.fulfill({
        status: 503,
        json: { error: { code: 'connection_unavailable', message: 'Не удалось загрузить пути.' } },
      });
    }
    const vacancyId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
    );
    return route.fulfill({ json: connectionResponse(vacancyId, state.connectionMode) });
  });
}

async function installPitchRoute(page: Page, state: LetterRouteState): Promise<void> {
  await page.route('**/api/v1/candidate/vacancies/*/pitch', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON() as PitchRequestBody;
    state.pitchBodies.push(request);
    if (state.pitchMode === 'slow') {
      state.pendingPitch = route;
      return;
    }
    if (state.pitchMode === 'error') {
      return route.fulfill({
        status: 502,
        json: { error: { code: 'pitch_unavailable', message: 'Не удалось подготовить письмо.' } },
      });
    }
    const vacancyId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
    );
    return route.fulfill({ json: pitchResponse(vacancyId, state.pitchMode, request) });
  });
}

async function installApprovalRoute(page: Page, state: LetterRouteState): Promise<void> {
  await page.route('**/api/v1/candidate/vacancies/*/letter-approvals', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    state.approvedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 200,
      json: {
        data: {
          applicationId: 'application-b449-approved',
          documentId: 'document-b449-letter',
          approvedAt: '2026-10-10T12:00:00.000Z',
          status: 'approved',
          sent: false,
        },
      },
    });
  });
}

async function installLetterMocks(page: Page, state: LetterRouteState): Promise<void> {
  await mockSignedInCabinet(page);
  await installConnectionRoute(page, state);
  await installPitchRoute(page, state);
  await installApprovalRoute(page, state);
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;
    if (/\/candidate\/(?:actions|vacancies\/[^/]+\/(?:apply|send|submit))$/u.test(pathname)) {
      state.sendAttempts.push(pathname);
    }
  });
}

async function openLetter(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const vacanciesNavigation = page.locator('button[aria-label="Вакансии"]:visible').first();
  await expect(vacanciesNavigation).toBeVisible({ timeout: 15_000 });
  await vacanciesNavigation.click();
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Вакансии', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const firstItem = page.locator('.vac-list-item').first();
  await expect(firstItem).toBeVisible();
  const row = firstItem.locator('.vac-row');
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await firstItem
    .locator('.vac-detail')
    .getByRole('button', { name: 'Сопроводительное письмо', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Письмо под вакансию' })).toBeVisible();
}

async function waitForLetter(page: Page): Promise<void> {
  await expect(page.getByRole('textbox', { name: 'Текст письма' })).toHaveValue(/\S+/u);
}

async function reviewWithConsultant(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Попросить правки у консультанта' }).click();
  const panel = page.locator('aside.career-expert-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('header strong')).toHaveText('Консультант · Вакансии');
  await page.getByRole('button', { name: 'Закрыть карьерного консультанта' }).click();
  await expect(panel).toBeHidden();
}

async function showIntroductionPaths(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Показать пути' }).click();
  await expect(page.locator('.career-letter-circle-section')).toContainText(
    'Попросить представить',
  );
}

async function captureState(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const mobile = testInfo.project.name === 'mobile-390';
  expect(page.viewportSize()).toEqual(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const viewport = mobile ? '390x844' : '1440x900';
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(mobile ? 390 : 1440);
  await page.screenshot({
    path: join(EVIDENCE_DIR, viewport + '-' + name + '.png'),
    animations: 'disabled',
  });
}

async function releaseConnections(
  state: LetterRouteState,
  mode: ConnectionMode = 'rich',
): Promise<void> {
  const route = state.pendingConnection;
  if (!route) throw new Error('Ожидаемый запрос кругов связей не перехвачен.');
  state.pendingConnection = null;
  state.connectionMode = mode;
  const vacancyId = decodeURIComponent(
    new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
  );
  await route.fulfill({ json: connectionResponse(vacancyId, mode) });
}

async function releasePitch(state: LetterRouteState, mode: PitchMode = 'rich'): Promise<void> {
  const route = state.pendingPitch;
  if (!route) throw new Error('Ожидаемый запрос письма не перехвачен.');
  state.pendingPitch = null;
  state.pitchMode = mode;
  const request = route.request().postDataJSON() as PitchRequestBody;
  const vacancyId = decodeURIComponent(
    new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
  );
  await route.fulfill({ json: pitchResponse(vacancyId, mode, request) });
}

test.describe('B449 — письмо под вакансию', () => {
  test('shows circle and letter loading states, then a fact-backed draft', async ({
    page,
  }, testInfo) => {
    const state = createRouteState('slow', 'slow');
    await installLetterMocks(page, state);
    await openLetter(page);
    await expect(page.getByText('Загружаем круги связей…')).toBeVisible();
    await captureState(page, testInfo, 'connections-loading');
    await releaseConnections(state);
    await expect(page.getByText('Письмо готовится по профилю и вакансии…')).toBeVisible();
    await captureState(page, testInfo, 'pitch-loading');
    await releasePitch(state);
    await waitForLetter(page);
    await expect(page.getByText(/письмо опирается только на выбранные факты/u)).toBeVisible();
    await captureState(page, testInfo, 'high-facts');
  });

  test('selects circle recipients, workplace evidence and approves an unsent snapshot', async ({
    page,
  }, testInfo) => {
    const state = createRouteState();
    await installLetterMocks(page, state);
    await openLetter(page);
    await waitForLetter(page);
    await expect(page.getByRole('radio')).toHaveCount(2);
    await captureState(page, testInfo, 'circle-1');
    await page.getByRole('radio').nth(1).check();
    await expect.poll(() => state.pitchBodies.at(-1)?.recipient?.name).toBe('Анатолий Волков');
    await page.getByRole('button', { name: 'Круг 2' }).click();
    await expect(page.locator('.career-letter-circle-section')).toContainText(
      'Попросить представить',
    );
    await captureState(page, testInfo, 'circle-2');
    await page.getByRole('button', { name: 'Круг 3' }).click();
    await expect(page.locator('.career-letter-circle-section')).toContainText('Холодный отклик');
    await captureState(page, testInfo, 'circle-3');
    await reviewWithConsultant(page);
    const workplace = page.locator('.career-letter-screen').getByRole('checkbox').first();
    await workplace.uncheck();
    await expect.poll(() => state.pitchBodies.at(-1)?.excludedEvidenceIds).toEqual([FACT_ID]);
    await expect(
      page.getByText(
        'В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.',
        { exact: true },
      ),
    ).toBeVisible();
    await captureState(page, testInfo, 'few-facts-by-workplace');
    await workplace.check();
    await waitForLetter(page);
    await page
      .getByRole('textbox', { name: 'Текст письма' })
      .fill('Кандидат одобрил этот снимок письма.');
    await page.getByRole('button', { name: 'Одобрить письмо' }).click();
    await expect(page.getByRole('status')).toContainText('Ничего не отправлено.');
    await captureState(page, testInfo, 'approved');
    expect(state.approvedBody).toMatchObject({
      circle: 3,
      body: 'Кандидат одобрил этот снимок письма.',
      includedWorkplaceIds: [WORKPLACE_ID],
      usedEvidenceIds: [FACT_ID],
    });
    expect(state.sendAttempts).toEqual([]);
  });

  test('recovers from generation errors and shows English and few-facts notices', async ({
    page,
  }, testInfo) => {
    const state = createRouteState('rich', 'error');
    await installLetterMocks(page, state);
    await openLetter(page);
    await expect(page.locator('.career-letter-error')).toContainText(
      'Не удалось подготовить письмо.',
    );
    await captureState(page, testInfo, 'pitch-error');
    state.pitchMode = 'rich';
    await page.locator('.career-letter-error').getByRole('button', { name: 'Повторить' }).click();
    await waitForLetter(page);
    state.pitchMode = 'english';
    await page.getByLabel('Язык').selectOption('en');
    await expect(page.getByText('Частично: язык English')).toBeVisible();
    await captureState(page, testInfo, 'english-partial');
    state.pitchMode = 'few';
    await page.getByLabel('Тон').selectOption('technical');
    await expect(
      page.getByText(
        'В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.',
        { exact: true },
      ),
    ).toBeVisible();
    await captureState(page, testInfo, 'few-facts');
  });

  test('shows no-acquaintance state and opens the contact action', async ({ page }, testInfo) => {
    const state = createRouteState('none', 'rich');
    await installLetterMocks(page, state);
    await openLetter(page);
    await expect(page.locator('.career-letter-circle-empty')).toContainText(
      'В доступных кандидатских связях знакомых не найдено.',
    );
    await captureState(page, testInfo, 'no-acquaintances');
    await page.getByRole('button', { name: 'Добавить контакт' }).click();
    const networking = page.getByRole('dialog');
    await expect(networking).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(networking).toBeHidden();
    await showIntroductionPaths(page);
    await captureState(page, testInfo, 'circle-2-no-direct-contact');
    await page.getByRole('button', { name: 'Назад к вакансиям' }).click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();
  });

  test('shows connection error and retries the circle request', async ({ page }, testInfo) => {
    const state = createRouteState('error', 'rich');
    await installLetterMocks(page, state);
    await openLetter(page);
    await expect(page.locator('.career-letter-error')).toContainText('Не удалось загрузить пути.');
    await captureState(page, testInfo, 'connections-error');
    state.connectionMode = 'rich';
    await page.locator('.career-letter-error').getByRole('button', { name: 'Повторить' }).click();
    await waitForLetter(page);
    await expect(page.getByRole('button', { name: 'Круг 1' })).toBeVisible();
  });
});
