import { mkdir, writeFile } from 'node:fs/promises';
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

interface ManualConnectionContact {
  readonly id: string;
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly relationship: string;
  readonly strength: 'strong' | 'weak' | 'unknown';
  readonly workplaces: readonly [];
  readonly knowsRecruiterIds: readonly [];
  readonly source: 'manual';
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface LetterRouteState {
  connectionMode: ConnectionMode;
  pitchMode: PitchMode;
  pendingConnection: Route | null;
  pendingPitch: Route | null;
  pitchBodies: PitchRequestBody[];
  approvedBody: Record<string, unknown> | null;
  approvedResult: {
    readonly applicationId: string;
    readonly documentId: string;
    readonly approvedAt: string;
    readonly vacancyId: string;
  } | null;
  sendAttempts: string[];
  manualContacts: ManualConnectionContact[];
}

const EVIDENCE_DIR = join(process.cwd(), 'test-results', 'evidence', 'AUD-9');
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
    approvedResult: null,
    sendAttempts: [],
    manualContacts: [],
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

function connectionResponse(
  vacancyId: string,
  mode: ConnectionMode,
  manualContacts: readonly ManualConnectionContact[] = [],
) {
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
  const candidate = {
    id: 'candidate-b449',
    fullName: 'Кандидат',
    roleTitle: null,
    companyName: null,
  };
  const noDirectContacts = mode === 'none';
  const manualPaths = manualContacts.map((contact) => {
    const person = {
      id: contact.id,
      fullName: contact.fullName,
      roleTitle: contact.roleTitle || null,
      companyName: contact.companyName,
    };
    return {
      ...connectionPath(
        `manual-${contact.id}`,
        1,
        person,
        [candidate, person],
        'write_known_contact',
      ),
      strength: contact.strength,
      evidence: [contact.relationship],
    };
  });
  const directPaths = noDirectContacts
    ? manualPaths
    : [
        connectionPath('direct-maria', 1, colleague, [], 'write_known_contact'),
        connectionPath(
          'direct-anatoly',
          1,
          { ...colleague, id: 'person-anatoly', fullName: 'Анатолий Волков' },
          [],
          'write_known_contact',
        ),
        ...manualPaths,
      ];
  const directState = directPaths.length > 0 ? 'available' : 'none';
  return {
    data: {
      vacancyId,
      companyKey: 'genetec',
      companyName: 'Genetec',
      vacancyTitle: 'Business Information Architect',
      circles: [
        {
          circle: 1,
          state: directState,
          message:
            directPaths.length > 0
              ? (directPaths[0]?.evidence[0] ?? 'Есть знакомые в компании.')
              : 'В импортированном списке знакомых не найдено.',
          paths: directPaths,
        },
        {
          circle: 2,
          state: noDirectContacts ? directState : 'available',
          message: noDirectContacts
            ? 'В импортированном списке знакомых не найдено.'
            : 'Можно попросить представить через знакомого.',
          paths: noDirectContacts
            ? []
            : [
                connectionPath(
                  'intro-maria',
                  2,
                  recruiter,
                  [candidate, colleague, recruiter],
                  'ask_for_introduction',
                ),
                connectionPath(
                  'intro-anatoly',
                  2,
                  recruiter,
                  [
                    candidate,
                    { ...colleague, id: 'person-anatoly', fullName: 'Анатолий Волков' },
                    recruiter,
                  ],
                  'ask_for_introduction',
                ),
              ],
        },
        {
          circle: 3,
          state: 'available',
          message: 'Подготовьте холодный отклик по вакансии.',
          paths: [connectionPath('cold-team', 3, recruiter, [], 'cold_application')],
        },
      ],
      linkedinImport:
        mode === 'none'
          ? { state: 'imported', importedAt: '2026-10-14T10:00:00.000Z', importedCount: 0 }
          : { state: 'unknown', importedAt: null, importedCount: null },
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
      contactMessage:
        (request.recipient?.name ?? 'Контакт') + ', здравствуйте. Пишу по поводу роли в Genetec.',
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
    return route.fulfill({
      json: connectionResponse(vacancyId, state.connectionMode, state.manualContacts),
    });
  });
}

async function installConnectionContactRoutes(page: Page, state: LetterRouteState): Promise<void> {
  await page.route('**/api/v1/candidate/connection-contacts**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;
    if (path === '/api/v1/candidate/connection-contacts' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const items = state.manualContacts.slice(offset, offset + limit);
      return route.fulfill({
        json: {
          data: {
            items,
            total: state.manualContacts.length,
            offset,
            limit,
            nextOffset: null,
            linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
          },
        },
      });
    }
    const contactMatch = path.match(/^\/api\/v1\/candidate\/connection-contacts\/([^/]+)$/u);
    if (!contactMatch) return route.continue();
    const id = decodeURIComponent(contactMatch[1]!);
    if (method === 'DELETE') {
      state.manualContacts = state.manualContacts.filter((contact) => contact.id !== id);
      return route.fulfill({ status: 204 });
    }
    if (method !== 'PUT') return route.continue();
    const previous = state.manualContacts.find((contact) => contact.id === id);
    const now = '2026-10-14T10:00:00.000Z';
    const contact = {
      ...(route.request().postDataJSON() as Omit<
        ManualConnectionContact,
        'id' | 'source' | 'createdAt' | 'updatedAt'
      >),
      id,
      source: 'manual' as const,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    state.manualContacts = previous
      ? state.manualContacts.map((item) => (item.id === id ? contact : item))
      : [...state.manualContacts, contact];
    return route.fulfill({ status: previous ? 200 : 201, json: { data: contact } });
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
    const vacancyId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
    );
    state.approvedResult = {
      applicationId: 'application-b449-approved',
      documentId: 'document-b449-letter',
      approvedAt: '2026-10-10T12:00:00.000Z',
      vacancyId,
    };
    return route.fulfill({
      status: 200,
      json: {
        data: {
          applicationId: state.approvedResult.applicationId,
          documentId: state.approvedResult.documentId,
          approvedAt: state.approvedResult.approvedAt,
          status: 'approved',
          sent: false,
        },
      },
    });
  });
}

async function installLetterMocks(page: Page, state: LetterRouteState): Promise<void> {
  await mockSignedInCabinet(page, {
    applicationHandler: async (route, path) => {
      if (path !== '/api/v1/candidate/applications' || route.request().method() !== 'GET') {
        return false;
      }
      const approved = state.approvedResult;
      if (!approved) return false;
      return route
        .fulfill({
          json: {
            data: [
              {
                id: approved.applicationId,
                candidateId: 'candidate-fixture',
                clusterId: approved.vacancyId,
                stage: 'saved',
                materials: { coverLetter: true, resume: false },
                nearestInterview: null,
                archivePreviousStage: null,
                version: 1,
                vacancy: {
                  title: 'Business Information Architect',
                  company: 'Genetec',
                  url: 'https://example.test/vacancies/business-information-architect',
                  source: 'fixture',
                },
                createdAt: approved.approvedAt,
                updatedAt: approved.approvedAt,
              },
            ],
          },
        })
        .then(() => true);
    },
  });
  await installConnectionRoute(page, state);
  await installConnectionContactRoutes(page, state);
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
  const row = firstItem.locator('.vacancies-screen-row-trigger');
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await firstItem.locator('.vac-detail').getByRole('button', { name: 'Полное описание' }).click();
  await page
    .locator('.career-modal-card.is-detail')
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
  await expect(panel.locator('header strong')).toHaveText('Консультант');
  await expect(panel.locator('header small')).toContainText('Вакансии');
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
  const port = process.env.E2E_PORT ?? '4173';
  const staticHtml = (await page.content())
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/(href|src)="\/assets\//gu, `$1="http://127.0.0.1:${port}/assets/`);
  await writeFile(join(EVIDENCE_DIR, viewport + '-' + name + '.html'), staticHtml);
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
  await route.fulfill({ json: connectionResponse(vacancyId, mode, state.manualContacts) });
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
    await page.getByRole('tab', { name: /Круг 2/u }).click();
    await expect(page.locator('.career-letter-circle-section')).toContainText(
      'Попросить представить',
    );
    await expect.poll(() => state.pitchBodies.at(-1)?.recipient?.name).toBe('Мария Крылова');
    await expect(page.getByRole('textbox', { name: 'Текст письма' })).toHaveValue(
      /^Мария Крылова,/u,
    );
    const introductionRecipients = page.locator('.career-letter-screen').getByRole('radio');
    await introductionRecipients.nth(1).check();
    await expect.poll(() => state.pitchBodies.at(-1)?.recipient?.name).toBe('Анатолий Волков');
    await expect(page.getByRole('textbox', { name: 'Текст письма' })).toHaveValue(
      /^Анатолий Волков,/u,
    );
    await captureState(page, testInfo, 'circle-2');
    await page.getByRole('tab', { name: /Круг 3/u }).click();
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
    await expect(page.locator('.career-letter-approved')).toContainText('10.10.2026');
    await captureState(page, testInfo, 'approved');
    expect(state.approvedBody).toMatchObject({
      circle: 3,
      body: 'Кандидат одобрил этот снимок письма.',
      includedWorkplaceIds: [WORKPLACE_ID],
      usedEvidenceIds: [FACT_ID],
    });
    expect(state.sendAttempts).toEqual([]);
    await page.getByRole('button', { name: 'Отклики', exact: true }).last().click();
    await expect(page.getByRole('main')).toContainText('Business Information Architect');
    await expect(page.getByRole('main')).toContainText('Genetec');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Отклики"]:visible').first().click();
    await expect(page.getByRole('main')).toContainText('Business Information Architect');
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

    const preservedText = 'Кандидатская правка, которую нужно сохранить при ошибке.';
    await page.getByRole('textbox', { name: 'Текст письма' }).fill(preservedText);
    state.pitchMode = 'error';
    await page.getByLabel('Тон').selectOption('technical');
    await expect(page.locator('.career-letter-error')).toContainText(
      'Не удалось подготовить письмо.',
    );
    await expect(page.getByRole('textbox', { name: 'Текст письма' })).toHaveValue(preservedText);
    await captureState(page, testInfo, 'pitch-error-with-draft');

    state.pitchMode = 'few';
    await page.locator('.career-letter-error').getByRole('button', { name: 'Повторить' }).click();
    await waitForLetter(page);
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
      'В импортированном списке знакомых не найдено.',
    );
    await captureState(page, testInfo, 'no-acquaintances');
    await page.getByRole('button', { name: 'Добавить контакт' }).click();
    const contactDialog = page.getByRole('dialog', { name: 'Контакты' });
    await expect(contactDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(contactDialog).toBeHidden();
    await showIntroductionPaths(page);
    await captureState(page, testInfo, 'circle-2-no-direct-contact');
    await page.getByRole('button', { name: 'Назад к вакансиям' }).click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();
  });

  test('creates, reloads, edits and deletes a manual contact and refreshes its direct path', async ({
    page,
  }, testInfo) => {
    const state = createRouteState('none', 'rich');
    await installLetterMocks(page, state);
    await openLetter(page);
    await expect(page.locator('.career-letter-circle-empty')).toContainText(
      'В импортированном списке знакомых не найдено.',
    );
    await page.getByRole('button', { name: 'Добавить контакт' }).click();

    let dialog = page.getByRole('dialog', { name: 'Контакты' });
    await expect(dialog).toBeVisible();
    await captureState(page, testInfo, 'contact-manager');
    await dialog.getByLabel('Имя').fill('Елена Мельникова');
    await dialog.getByLabel('Компания').fill('Genetec');
    await dialog.getByLabel('Роль').fill('Продакт-менеджер');
    await dialog.getByLabel('Как вы знакомы').fill('Работали вместе в одной команде');
    await dialog.getByRole('button', { name: 'Сохранить контакт' }).click();
    await expect(dialog.getByRole('status')).toContainText('Контакт сохранён.');
    await expect(page.getByRole('radio')).toHaveCount(1);
    await expect(page.locator('.career-letter-circle-section')).toContainText('Елена Мельникова');
    await dialog.getByRole('button', { name: 'Закрыть контакты' }).click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openLetter(page);
    await page.getByRole('button', { name: 'Управлять контактами' }).click();
    dialog = page.getByRole('dialog', { name: 'Контакты' });
    const contact = dialog.getByRole('listitem').filter({ hasText: 'Елена Мельникова' });
    await expect(contact).toBeVisible();
    await contact.getByRole('button', { name: 'Изменить контакт Елена Мельникова' }).click();
    await dialog.getByLabel('Имя').fill('Елена Сергеева');
    await dialog.getByRole('button', { name: 'Сохранить контакт' }).click();
    await expect(dialog.getByRole('status')).toContainText('Контакт сохранён.');
    const editedContact = dialog.getByRole('listitem').filter({ hasText: 'Елена Сергеева' });
    await expect(editedContact).toBeVisible();
    await editedContact.getByRole('button', { name: 'Удалить контакт Елена Сергеева' }).click();
    await editedContact.getByRole('button', { name: 'Удалить контакт', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Контакт удалён.');
    await expect(dialog.getByRole('listitem')).toHaveCount(0);
    await expect(state.manualContacts).toHaveLength(0);
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
    await expect(page.getByRole('tab', { name: /Круг 1/u })).toBeVisible();
  });

  test('shows vacancy details, accessible circle tabs and an honest cold outreach state', async ({
    page,
  }, testInfo) => {
    const state = createRouteState();
    await installLetterMocks(page, state);
    await page.addInitScript(() => {
      const state = window as Window & { __openedUrls?: string[] };
      state.__openedUrls = [];
      window.open = ((url: string | URL) => {
        state.__openedUrls?.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await openLetter(page);
    await waitForLetter(page);

    await page.getByRole('button', { name: 'Открыть вакансию' }).click();
    const openedUrls = await page.evaluate(
      () => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? [],
    );
    expect(openedUrls).toHaveLength(1);
    expect(new URL(openedUrls[0]!).protocol).toMatch(/^https?:$/u);

    const details = page.locator('.career-letter-vacancy details');
    await expect(details).toHaveCount(1);
    await details.locator('summary').click();
    await expect(details.locator('p')).not.toBeEmpty();

    const tabs = page.getByRole('tablist', { name: 'Круг связей' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    const circleOne = tabs.getByRole('tab', { name: /Круг 1/u });
    await circleOne.focus();
    await page.keyboard.press('ArrowRight');
    const circleTwo = tabs.getByRole('tab', { name: /Круг 2/u });
    await expect(circleTwo).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.career-letter-circle-section')).toContainText(
      'Попросить представить',
    );
    await expect.poll(() => state.pitchBodies.at(-1)?.recipient?.name).toBe('Мария Крылова');
    await circleTwo.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /Круг 3/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const delivery = page.locator('.career-letter-delivery-summary');
    await expect(delivery).toContainText('Резюме не прикреплено');
    await expect(delivery.getByRole('button')).toHaveCount(0);
    await captureState(page, testInfo, 'cold-outreach-availability');
  });

  test('offers a real consultant route when the profile has too few facts', async ({ page }) => {
    const state = createRouteState('rich', 'few');
    await installLetterMocks(page, state);
    await openLetter(page);
    await waitForLetter(page);
    await expect(
      page.getByText(
        'В профиле мало подтверждённых фактов: письмо не добавляет достижения без источника.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Собрать факты с консультантом' }).click();
    const panel = page.locator('aside.career-expert-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('header small')).toContainText('Профиль');
  });

  test('keeps the screen within 280px and primary interaction targets at 44px', async ({
    page,
  }) => {
    const state = createRouteState();
    await installLetterMocks(page, state);
    await openLetter(page);
    await waitForLetter(page);
    await page.setViewportSize({ width: 280, height: 840 });

    const circleOne = page.getByRole('tab', { name: /Круг 1/u });
    await circleOne.focus();
    await circleOne.press('ArrowRight');
    const circleTwo = page.getByRole('tab', { name: /Круг 2/u });
    await expect(circleTwo).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() => circleTwo.evaluate((tab) => getComputedStyle(tab).outlineStyle))
      .toBe('solid');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(280);
    const dimensions = await page
      .locator(
        '.career-letter-screen .career-letter-circle-tab, .career-letter-screen button, .career-letter-screen select, .career-letter-screen textarea, .career-letter-path-option, .career-letter-workplaces li label',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
    expect(dimensions.length).toBeGreaterThan(0);
    expect(dimensions.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  });
});
