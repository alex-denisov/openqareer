import { expect, test, type Page, type Route } from '@playwright/test';
import { createMockInterviewSimulatorFixture } from './fixtures/mockInterviewSimulator';
import { captureCareerHarness } from './helpers/capture-career-harness';

type RecordValue = Record<string, unknown>;
type ApplicationRecord = RecordValue & { id: string; stage: string; vacancy: RecordValue | null };
type CapturedCalls = {
  readonly applicationQueries: string[];
  readonly companyMutations: Array<{ method: string; path: string; body?: unknown }>;
  readonly outboundRetryPaths: string[];
  applicationBulkPreview?: RecordValue;
  applicationBulkExecute?: RecordValue;
  applicationBulkResponse?: RecordValue;
  companyBulkPreview?: RecordValue;
  companyBulkExecute?: RecordValue;
  createdApplication?: ApplicationRecord;
  savedOffer?: RecordValue;
};

const candidate = {
  username: 'b450.candidate',
  email: 'b450@example.com',
  displayName: 'Кандидат B450',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b450',
};

const account = {
  username: candidate.username,
  email: candidate.email,
  displayName: candidate.displayName,
  profile: { headline: 'Руководитель платформы', location: 'Москва', workMode: 'hybrid' as const },
  sessions: [],
};

const confirmedEvidenceItems = [
  {
    id: 'evidence-1',
    kind: 'result' as const,
    sourceExcerpt: 'Сократил время закрытия вакансий на 30%',
    statement: 'Сократил время закрытия вакансий на 30%',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-2',
    kind: 'scope' as const,
    sourceExcerpt: 'Руководил командой архитекторов из 12 человек',
    statement: 'Руководил командой архитекторов из 12 человек',
    status: 'confirmed' as const,
    userEdited: false,
  },
  {
    id: 'evidence-3',
    kind: 'scope' as const,
    sourceExcerpt: 'Отвечал за архитектуру платформы в 3 регионах',
    statement: 'Отвечал за архитектуру платформы в 3 регионах',
    status: 'confirmed' as const,
    userEdited: false,
  },
];

const snapshot = {
  candidate: {
    id: candidate.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 0,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

const starStoriesSnapshot = {
  facts: [
    {
      id: 'evidence-1',
      statement: 'Сократил время закрытия вакансий на 30%',
      domain: 'result',
      createdAt: '2026-09-15T10:00:00.000Z',
    },
  ],
  stories: [
    {
      id: 'story-crisis',
      version: 1,
      title: 'Кризис в команде: уход ведущего инженера',
      fields: {
        situation: 'Ведущий инженер ушёл перед релизом.',
        task: 'Сохранить дату выпуска и распределить работу.',
        action: 'Пересобрал план и провёл ежедневные короткие разборы.',
        result: 'Сократил время закрытия вакансий на 30%.',
      },
      sourceFactIds: ['evidence-1'],
      confidence: 'confirmed',
      sourceFacts: [
        {
          id: 'evidence-1',
          statement: 'Сократил время закрытия вакансий на 30%',
          domain: 'result',
          createdAt: '2026-09-15T10:00:00.000Z',
        },
      ],
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    },
  ],
};

function offerTerms(baseSalary: number) {
  return {
    baseSalary,
    salaryPeriod: 'month',
    bonus: 0,
    currency: 'RUB',
    format: 'hybrid',
    probationPeriodMonths: null,
    probationSalary: null,
    benefits: [],
    risks: [],
    sourceNote: 'Тестовая запись',
  };
}

function makeApplication(id: number, stage = 'applied', needsAction = false): ApplicationRecord {
  const isOffer = stage === 'offer';
  const isInterview = stage === 'interview';
  const source = id % 3 === 0 ? 'LinkedIn' : id % 3 === 1 ? 'hh.ru' : 'Indeed';
  return {
    id: 'application-' + id,
    candidateId: candidate.candidateId,
    clusterId: null,
    stage,
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      id: 'vacancy-' + id,
      title: 'Руководитель платформы ' + id,
      company: 'Компания ' + id,
      companyHidden: false,
      source,
      url: null,
      location: 'Москва',
    },
    notes: null,
    followUpDueAt: needsAction ? '2026-10-10T10:00:00.000Z' : null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: needsAction
      ? {
          dueAt: '2026-10-10T10:00:00.000Z',
          urgency: 'overdue',
          source: 'standard_schedule',
          daysSinceContact: 14,
        }
      : null,
    whoseTurn: needsAction || isInterview ? 'candidate' : 'company',
    materials: { coverLetter: id % 5 !== 0, resume: true },
    nearestInterview: isInterview
      ? {
          id: 'interview-' + id,
          scheduledAt: '2026-10-15T10:00:00.000Z',
          prepStatus: 'none',
          round: 1,
        }
      : null,
    archiveStaleDays: 30,
    deliveryReceipt:
      stage !== 'applied'
        ? null
        : id % 4 === 0
          ? { kind: 'failure_note', value: 'Сайт не подтвердил отправку' }
          : id % 4 === 1
            ? { kind: 'confirmation_url', value: 'https://jobs.test/receipts/' + id }
            : null,
    offer: isOffer
      ? { terms: offerTerms(400000 + id * 10000), sourceLabel: 'Сохранено кандидатом' }
      : null,
  };
}

function createApplications(): ApplicationRecord[] {
  const firstPage = [
    ...Array.from({ length: 10 }, () => 'applied'),
    ...Array.from({ length: 5 }, () => 'responded'),
    ...Array.from({ length: 4 }, () => 'interview'),
    'offer',
  ];
  const stages = [
    ...firstPage,
    ...Array.from({ length: 836 }, () => 'applied'),
    ...Array.from({ length: 93 }, () => 'responded'),
    ...Array.from({ length: 18 }, () => 'interview'),
    'offer',
    ...Array.from({ length: 16 }, () => 'rejected'),
    ...Array.from({ length: 16 }, () => 'archived'),
  ];
  let actionableApplications = 0;
  return stages.map((stage, index) => {
    const needsAction = stage === 'applied' && actionableApplications < 14;
    if (needsAction) actionableApplications += 1;
    return makeApplication(index + 1, stage, needsAction);
  });
}

function createCompanies() {
  return [
    {
      key: 'northstar',
      name: 'Northstar Labs',
      location: 'Москва',
      industry: 'Технологии',
      vacancyCount: 3,
      contactsCount: 0,
      contactsImportedAt: null,
      want: true,
      nextStep: { text: 'Изучить вакансии', dueAt: null },
      hasRecruiter: false,
      recruiterSearchStatus: 'idle',
      sources: [],
      vacancies: [],
      recruiters: [],
    },
    {
      key: 'orbital',
      name: 'Orbital Systems',
      location: 'Санкт-Петербург',
      industry: 'ИТ',
      vacancyCount: 2,
      contactsCount: null,
      contactsImportedAt: null,
      want: false,
      nextStep: null,
      hasRecruiter: false,
      recruiterSearchStatus: 'idle',
      sources: [],
      vacancies: [],
      recruiters: [],
    },
  ];
}

function companyPage(
  companies: ReturnType<typeof createCompanies>,
  filter: string,
  offset: number,
) {
  const filtered = filter === 'want' ? companies.filter((item) => item.want) : companies;
  return {
    items: filtered.slice(offset, offset + 20),
    total: filtered.length,
    offset,
    limit: 20,
    sort: 'default',
    filter,
    filterCounts: {
      all: companies.length,
      want: companies.filter((item) => item.want).length,
      contacts: null,
      recruiter: 0,
    },
    linkedin: { status: 'not_connected', importedAt: null, contactsImported: false },
    searchConsentGranted: true,
  };
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

async function handleApplicationRoute(
  route: Route,
  calls: CapturedCalls,
  applications: ApplicationRecord[],
): Promise<boolean> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const path = url.pathname;
  if (path === '/api/v1/candidate/applications' && method === 'GET') {
    calls.applicationQueries.push(url.href);
    const stages = url.searchParams.getAll('stage');
    const channels = url.searchParams.getAll('channel');
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const cohort = filterMockApplications(applications, { channel: channels, from, to });
    const filtered = filterMockApplications(cohort, { stage: stages });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const items = filtered.slice(offset, offset + limit);
    const stageCounts = cohort.reduce<Record<string, number>>(
      (counts, item) => ({ ...counts, [item.stage]: (counts[item.stage] ?? 0) + 1 }),
      {},
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: items,
        meta: {
          total: filtered.length,
          offset,
          limit,
          nextOffset: offset + items.length < filtered.length ? offset + items.length : null,
          stageCounts,
        },
      }),
    });
    return true;
  }
  if (path.endsWith('/applications/bulk/preview') && method === 'POST') {
    const body = request.postDataJSON() as RecordValue;
    const filters = body.filters as RecordValue;
    const action = body.action as RecordValue;
    const matches = filterMockApplications(applications, filters);
    const affectedCount =
      action.type === 'retry'
        ? matches.filter((item) => item.deliveryReceipt?.kind === 'failure_note').length
        : matches.length;
    calls.applicationBulkPreview = { ...body, affectedCount };
    await fulfill(route, { affectedCount, operationId: 'b450-preview' });
    return true;
  }
  if (path.endsWith('/applications/bulk') && method === 'POST') {
    const body = request.postDataJSON() as RecordValue;
    calls.applicationBulkExecute = body;
    const confirmCount = typeof body.confirmCount === 'number' ? body.confirmCount : 0;
    calls.applicationBulkResponse = {
      state: 'prepared',
      preparedCount: confirmCount,
      sentCount: 0,
    };
    await fulfill(route, calls.applicationBulkResponse);
    return true;
  }
  if (path === '/api/v1/candidate/applications' && method === 'POST') {
    const input = request.postDataJSON() as RecordValue;
    const manualVacancy = input.manualVacancy as RecordValue;
    const created = makeApplication(1001, 'offer');
    created.vacancy = {
      id: null,
      title: manualVacancy.title,
      company: manualVacancy.company,
      companyHidden: false,
      source: manualVacancy.source,
      url: null,
      location: null,
    };
    applications.push(created);
    calls.createdApplication = created;
    await fulfill(route, created);
    return true;
  }
  const offerMatch = path.match(/^\/api\/v1\/candidate\/applications\/([^/]+)\/offer$/);
  if (offerMatch && method === 'GET') {
    const saved =
      applications.find((item) => item.id === decodeURIComponent(offerMatch[1] ?? ''))?.offer ??
      null;
    await fulfill(route, saved);
    return true;
  }
  if (offerMatch && method === 'PUT') {
    const body = request.postDataJSON() as RecordValue;
    calls.savedOffer = body;
    const applicationId = decodeURIComponent(offerMatch[1] ?? '');
    const offer = {
      applicationId,
      terms: body.terms,
      respondBy: body.respondBy ?? null,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
    };
    const index = applications.findIndex((item) => item.id === applicationId);
    if (index >= 0) applications[index] = { ...applications[index], offer };
    await fulfill(route, offer);
    return true;
  }
  return false;
}

function filterMockApplications(
  applications: readonly ApplicationRecord[],
  filters: RecordValue,
): ApplicationRecord[] {
  const stages = Array.isArray(filters.stage) ? filters.stage.map(String) : [];
  const channels = Array.isArray(filters.channel) ? filters.channel.map(String) : [];
  const from = typeof filters.from === 'string' ? filters.from : '';
  const to = typeof filters.to === 'string' ? filters.to : '';
  return applications.filter((item) => {
    const date = String(item.createdAt).slice(0, 10);
    return (
      (!stages.length || stages.includes(item.stage)) &&
      (!channels.length || channels.includes(String(item.vacancy?.source ?? ''))) &&
      (!from || date >= from) &&
      (!to || date <= to)
    );
  });
}

async function handleCompanyRoute(
  route: Route,
  calls: CapturedCalls,
  companies: ReturnType<typeof createCompanies>,
): Promise<boolean> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  if (path === '/api/v1/candidate/companies' && method === 'GET') {
    await fulfill(
      route,
      companyPage(
        companies,
        url.searchParams.get('filter') ?? 'all',
        Number(url.searchParams.get('offset') ?? 0),
      ),
    );
    return true;
  }
  const match = path.match(
    /^\/api\/v1\/candidate\/companies\/([^/]+)\/(want|next-step|recruiter-search)$/,
  );
  if (match) {
    const key = decodeURIComponent(match[1] ?? '');
    const action = match[2] ?? '';
    const company = companies.find((item) => item.key === key);
    const body = method === 'PUT' || method === 'POST' ? request.postDataJSON() : undefined;
    calls.companyMutations.push({ method, path, body });
    if (company && action === 'want') company.want = method === 'PUT';
    if (company && action === 'next-step')
      company.nextStep = body as { text: string; dueAt: string | null };
    if (action === 'recruiter-search') {
      if (company) company.recruiterSearchStatus = 'queued';
      await fulfill(route, { searchStatus: 'queued' });
      return true;
    }
    await fulfill(route, null);
    return true;
  }
  if (path.endsWith('/company-wants/bulk/preview') && method === 'POST') {
    calls.companyBulkPreview = request.postDataJSON() as RecordValue;
    await fulfill(route, { affectedCount: 2, operationId: 'b450-company-preview' });
    return true;
  }
  if (path.endsWith('/company-wants/bulk') && method === 'POST') {
    calls.companyBulkExecute = request.postDataJSON() as RecordValue;
    await fulfill(route, { changedCount: 2, state: 'completed' });
    return true;
  }
  return false;
}

async function installMocks(page: Page): Promise<CapturedCalls> {
  const calls: CapturedCalls = {
    applicationQueries: [],
    companyMutations: [],
    outboundRetryPaths: [],
  };
  const applications = createApplications();
  const companies = createCompanies();
  const interviewFixture = createMockInterviewSimulatorFixture();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/(send|retry)(\/|$)/i.test(path))
      calls.outboundRetryPaths.push(path);
    if (path === '/api/v1/auth/me') return fulfill(route, candidate);
    if (path === '/api/v1/candidate/me') return fulfill(route, snapshot);
    if (path === '/api/v1/account') return fulfill(route, account);
    if (path === '/api/v1/candidate/connections') return fulfill(route, []);
    if (path === '/api/v1/candidate/workspace') return fulfill(route, null);
    if (path === '/api/v1/candidate/star-stories' && request.method() === 'GET')
      return fulfill(route, starStoriesSnapshot);
    if (path.startsWith('/api/v1/candidate/interview-sessions')) {
      const response = interviewFixture.handle(
        path,
        request.method(),
        request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : {},
      );
      if (response && 'error' in response) {
        return route.fulfill({
          status: response.status ?? 400,
          json: { error: response.error },
        });
      }
      if (response) {
        return route.fulfill({
          status: response.status ?? 200,
          json: { data: response.data },
        });
      }
    }
    if (path === '/api/v1/candidate/me/messages') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { nextOffset: null } }),
      });
    }
    if (await handleApplicationRoute(route, calls, applications)) return;
    if (await handleCompanyRoute(route, calls, companies)) return;
    await fulfill(route, null);
  });
  return calls;
}

async function seedWorkspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId, workspace }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: candidate.candidateId,
      workspace: {
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        resumeText:
          'Enterprise Architect with 15+ years scaling platform and operations organisations.',
        resumeSource: 'text',
        targetDirection: 'Enterprise Architect',
        regions: ['mena', 'eu'],
        currentSituation: 'Ищу роль Enterprise Architect.',
        constraints: 'Hybrid',
        urgency: 'active',
        outcomes: [],
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: confirmedEvidenceItems,
          questions: [],
          roleHypotheses: [
            {
              id: 'role-enterprise-architect',
              title: 'Enterprise Architect',
              fitState: 'plausible',
              basis: 'Опыт архитектуры платформы и управления командой',
              evidenceIds: ['evidence-1', 'evidence-2', 'evidence-3'],
              gaps: [],
            },
          ],
        },
      },
    },
  );
}

async function openResponses(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
  await expect(
    page
      .getByRole('navigation', { name: 'Разделы откликов' })
      .getByRole('tab', { name: 'Воронка' }),
  ).toBeVisible();
}

async function hideConsultantForEvidence(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: 'Закрыть карьерного консультанта' });
  if (await closeButton.isVisible()) await closeButton.click();
}

async function waitForResponsesPool(page: Page) {
  await expect(page.locator('.career-responses-pool-status')).toHaveCount(0);
}

test.describe('B450 responses workspace', () => {
  test('таблица загружается страницами, а массовый повтор только готовит очередь', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const calls = await installMocks(page);
    await seedWorkspace(page);
    await page.addInitScript(() => performance.mark('b450-load-start'));
    await openResponses(page);
    await expect(page.locator('.career-responses-column[aria-label="Отправлено"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Колонки', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const firstPageMs = await page.evaluate(
      () =>
        performance.now() - (performance.getEntriesByName('b450-load-start')[0]?.startTime ?? 0),
    );
    await testInfo.attach('b450-first-page-render-ms', {
      body: String(Math.round(firstPageMs)),
      contentType: 'text/plain',
    });
    expect(firstPageMs).toBeLessThan(10000);
    await waitForResponsesPool(page);
    await page.screenshot({
      path: testInfo.outputPath('b450-board-after-1440.png'),
      fullPage: true,
    });
    await captureCareerHarness(
      page,
      testInfo.outputPath('b450-board-harness.html'),
      '.career-responses-board-wrap',
    );
    const tableButton = page.getByRole('button', { name: 'Таблица', exact: true });
    await tableButton.click();
    await expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.career-responses-table')).toBeVisible();
    const rows = page.locator('.career-responses-table tbody tr');
    await expect(rows).toHaveCount(20);
    await page.screenshot({ path: testInfo.outputPath('b450-table-1440.png'), fullPage: true });
    await page.getByRole('button', { name: 'Показать ещё' }).click();
    await expect(rows).toHaveCount(40);
    await page.getByRole('checkbox', { name: 'Выбрать отклики на странице' }).check();
    await page.getByRole('button', { name: 'Выбрать все 968 по фильтру' }).click();
    await page.getByRole('combobox', { name: 'Действие' }).selectOption('retry');
    await page.getByRole('button', { name: 'Проверить', exact: true }).click();
    const confirm = page.getByRole('button', { name: /Подтвердить \d+/ });
    const confirmCount = Number((await confirm.textContent())?.match(/\d+/)?.[0] ?? 0);
    expect(confirmCount).toBeGreaterThan(0);
    await confirm.click();
    await expect(page.locator('.career-responses-table-wrap [role="status"]')).toContainText(
      'В очередь подготовлено ' + confirmCount + '; отправлено 0.',
    );
    expect(calls.applicationBulkPreview).toMatchObject({ action: { type: 'retry' } });
    expect(calls.applicationBulkExecute).toMatchObject({
      action: { type: 'retry' },
      confirmCount,
    });
    expect(calls.applicationBulkResponse).toMatchObject({
      state: 'prepared',
      preparedCount: confirmCount,
      sentCount: 0,
    });
    expect(calls.outboundRetryPaths).toEqual([]);
  });

  test('мобильный список остаётся в пределах 390 px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await waitForResponsesPool(page);
    await expect(page.locator('.career-responses-column[aria-label="Отправлено"]')).toBeVisible();
    await expect(
      page.locator('.career-responses-column .career-responses-card').first(),
    ).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const smallTargets = await page
      .locator(
        '.career-cabinet-view-responses button:not(:disabled), .career-cabinet-view-responses input:not([type=hidden]):not(:disabled), .career-cabinet-view-responses select:not(:disabled), .career-cabinet-view-responses textarea:not(:disabled), .career-cabinet-view-responses [role=button], .career-cabinet-view-responses [role=tab]',
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              element.getClientRects().length > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
              width: rect.width,
              height: rect.height,
            };
          })
          .filter((target) => target.width < 44 || target.height < 44),
      );
    expect(smallTargets).toEqual([]);

    await page.getByRole('searchbox', { name: 'Компания, роль или площадка' }).focus();
    await page.keyboard.press('Tab');
    const hasVisibleFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        active.matches(':focus-visible') &&
        getComputedStyle(active).outlineStyle !== 'none' &&
        Number.parseFloat(getComputedStyle(active).outlineWidth) > 0
      );
    });
    expect(hasVisibleFocus).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('b450-board-after-390.png'),
      fullPage: true,
    });
  });

  test('компании сохраняют желание, следующий шаг, поиск пути и пакетное действие', async ({
    page,
  }, testInfo) => {
    const calls = await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await page.getByRole('tab', { name: 'Хочу в компанию' }).click();
    const panel = page.locator('section[aria-label="Компании, которые интересуют"]');
    await expect(panel.getByText('Northstar Labs')).toBeVisible();
    await panel.getByRole('button', { name: 'Добавить компании' }).click();
    const row = page
      .locator('.career-responses-company-row')
      .filter({ hasText: 'Orbital Systems' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Хочу в компанию' }).click();
    await row.getByLabel('Следующий шаг').fill('Написать нанимающему менеджеру');
    await row.getByRole('button', { name: 'Сохранить шаг' }).click();
    await row.getByRole('button', { name: 'Найти путь к рекрутеру' }).click();
    await expect(row).toContainText('Ищем путь к рекрутеру');
    await expect(row.getByRole('button', { name: 'Найти путь к рекрутеру' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Выбрать все 2 по фильтру' }).click();
    await panel.getByRole('button', { name: 'Проверить', exact: true }).click();
    await panel.getByRole('button', { name: 'Подтвердить 2' }).click();
    expect(calls.companyMutations.map((call) => call.path)).toEqual(
      expect.arrayContaining([
        '/api/v1/candidate/companies/orbital/want',
        '/api/v1/candidate/companies/orbital/next-step',
        '/api/v1/candidate/companies/orbital/recruiter-search',
      ]),
    );
    expect(
      calls.companyMutations.find((call) => call.path.endsWith('/next-step'))?.body,
    ).toMatchObject({ text: 'Написать нанимающему менеджеру' });
    expect(calls.companyBulkPreview).toMatchObject({ action: 'add' });
    expect(calls.companyBulkExecute).toMatchObject({ confirmCount: 2 });
    if (page.viewportSize()?.width === 390) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: testInfo.outputPath('b450-companies.png'), fullPage: false });
  });

  test('оффер сохраняет состав компенсации и открывается в сравнении', async ({
    page,
  }, testInfo) => {
    const calls = await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await page.getByRole('tab', { name: 'Офферы' }).click();
    await expect(page.getByRole('button', { name: 'Сравнить офферы' })).toBeEnabled();
    await page.getByRole('button', { name: 'Добавить оффер' }).click();
    await page
      .locator('form.career-responses-add-offer')
      .getByRole('textbox', { name: 'Компания' })
      .fill('Polar Systems');
    await page
      .locator('form.career-responses-add-offer')
      .getByRole('textbox', { name: 'Роль' })
      .fill('VP Engineering');
    await page.getByRole('button', { name: 'Продолжить к условиям' }).click();
    const dialog = page.getByRole('dialog', { name: 'Условия оффера — Polar Systems' });
    await dialog.getByLabel('Базовый оклад').fill('500000');
    await dialog.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.createdApplication?.stage).toBe('offer');
    expect(calls.savedOffer).toMatchObject({
      terms: { baseSalary: 500000, salaryPeriod: 'month' },
    });
    await page.getByRole('button', { name: 'Сравнить офферы' }).click();
    const comparison = page.getByRole('dialog', { name: 'Сравнение офферов' });
    await expect(comparison).toBeVisible();
    if (page.viewportSize()?.width === 390) await expect(comparison).toBeInViewport();
    const companyLabel =
      page.viewportSize()?.width === 390
        ? comparison.locator('.career-offer-mobile-company').filter({ hasText: 'Polar Systems' })
        : comparison.locator('.career-offer-matrix-company').filter({ hasText: 'Polar Systems' });
    await expect(companyLabel).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('b450-offers.png'), fullPage: false });
  });

  test('пустая история консультанта не вызывает ошибку разбора ответа', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await expect(page.getByText('Консультант', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('b450-consultant-before-1440.png'),
      fullPage: true,
    });
    await expect(page.getByText(/Ответ сервиса не разобран/)).toHaveCount(0);
  });

  test('экран показывает вкладку подготовки и строку фильтров из макета 5', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await waitForResponsesPool(page);
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы откликов' })
        .getByRole('tab', { name: 'Подготовка' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Колонки', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByRole('searchbox', { name: 'Компания, роль или площадка' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Период откликов' })).toHaveValue('30');
    await expect(
      page
        .getByRole('navigation', { name: 'Разделы откликов' })
        .getByRole('button', { name: 'Автоматизация' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('b450-layout-after-1440.png'),
      fullPage: true,
    });
  });

  test('поиск находит запись за пределами первой страницы и показывает её реальные статусы', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await waitForResponsesPool(page);

    await page.getByRole('searchbox', { name: 'Компания, роль или площадка' }).fill('Компания 900');
    await page.getByRole('button', { name: 'Таблица', exact: true }).click();
    const rows = page.locator('.career-responses-table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('LinkedIn');
    await page.getByRole('combobox', { name: 'Канал отклика' }).selectOption('hh.ru');
    await waitForResponsesPool(page);
    await expect(page.getByRole('heading', { name: 'Отклики не найдены' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Канал отклика' }).selectOption('LinkedIn');
    await waitForResponsesPool(page);
    const matchingRow = page
      .locator('.career-responses-table tbody tr')
      .filter({ hasText: 'Компания 900' });
    await expect(matchingRow).toHaveCount(1);
    await matchingRow.getByRole('button', { name: /Открыть отклик/ }).click();
    const selected = page.locator('.career-responses-selected');
    await expect(selected).toContainText('Компания 900');
    await expect(selected).toContainText('Материалы');
    await expect(selected).toContainText('Доставка');
    await expect(selected).toContainText('О компании');
    await expect(selected).toContainText('проверенная карточка компании не привязана');
    await selected.screenshot({ path: testInfo.outputPath('b450-selected-response-1440.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await hideConsultantForEvidence(page);
    await selected.screenshot({ path: testInfo.outputPath('b450-selected-response-390.png') });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    await selected.getByRole('button', { name: 'Открыть STAR-истории' }).click();
    await expect(page.getByRole('dialog', { name: 'STAR-истории' })).toContainText(
      'Кризис в команде: уход ведущего инженера',
    );
  });

  test('selected response shows an unconfirmed delivery failure and its reason', async ({
    page,
  }) => {
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await waitForResponsesPool(page);
    await page.getByRole('searchbox', { name: 'Компания, роль или площадка' }).fill('Компания 4');
    await waitForResponsesPool(page);

    const failedResponse = page
      .locator('.career-responses-card-body')
      .filter({ hasText: /Компания 4(?!\d)/ });
    await expect(failedResponse).toHaveCount(1);
    await failedResponse.click();

    const selected = page.locator('.career-responses-selected');
    await expect(selected).toContainText('Попытка не удалась');
    await expect(selected).toContainText('Сайт не подтвердил отправку');
  });

  test('вкладка подготовки подключает STAR-истории и существующий поток мок-интервью', async ({
    page,
  }, testInfo) => {
    await installMocks(page);
    await seedWorkspace(page);
    await openResponses(page);
    await waitForResponsesPool(page);
    await page.getByRole('tab', { name: 'Подготовка' }).click();
    await page.screenshot({ path: testInfo.outputPath('b450-preparation.png'), fullPage: true });
    await captureCareerHarness(
      page,
      testInfo.outputPath('b450-preparation-harness.html'),
      '.career-responses-preparation',
    );

    await expect(page.getByRole('heading', { name: 'STAR на фактах профиля' })).toBeVisible();
    await expect(page.getByText('Кризис в команде: уход ведущего инженера')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Интервью и материалы' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать мок-интервью' })).toBeVisible();
    await page.getByRole('button', { name: 'Начать мок-интервью' }).click();

    const preparationDialog = page.getByRole('dialog', { name: /Интервью:/ });
    await expect(
      preparationDialog.getByRole('button', { name: 'Начать мок-интервью' }),
    ).toBeVisible();
    await preparationDialog.getByRole('button', { name: 'Начать мок-интервью' }).click();
    const simulator = page.getByRole('dialog', { name: 'Мок-интервью' });
    await expect(simulator).toBeVisible();
    await simulator.getByRole('button', { name: 'Начать', exact: true }).click();
    const activeSession = page.getByRole('dialog', { name: 'Вопрос' });
    await expect(activeSession.getByRole('heading', { name: /Вопрос 1 из/ })).toBeVisible();
  });
});
