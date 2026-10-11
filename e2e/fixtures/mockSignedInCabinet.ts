import type { Page, Route } from '@playwright/test';
import type { MatchedVacancyFacets } from '../../shared/matchedVacancyFacets';
import type { VacanciesScreenState } from '../../src/features/vacancies/VacanciesScreenFilters';
import { mockCandidateCompanies } from './mockCandidateCompanies';
import {
  account,
  candidate,
  candidateSnapshot,
  matchedVacancyPage,
  roleHypotheses,
  todaySnapshot,
  workspace,
} from './readabilityWorkspace';

interface ApplicationStub {
  readonly id: string;
  readonly candidateId: string;
  readonly clusterId: string | null;
  stage: string;
  archivePreviousStage: string | null;
  version: number;
  readonly vacancy: unknown;
  readonly createdAt: string;
  updatedAt: string;
}

export interface MockSignedInCabinetOptions {
  readonly vacancyTotal?: number;
  readonly vacancyFacets?: MatchedVacancyFacets;
  readonly vacancyInitialFilters?: VacanciesScreenState;
  readonly savedVacanciesCount?: number;
  readonly companyCount?: number;
}

function seedInitialVacancyItems(
  items: ReturnType<typeof matchedVacancyPage>['data'],
): typeof items {
  return items.map((item, index) => {
    // Keep the original Berlin Product Lead fixture for the later action flow.
    if (index >= 6 || index === 1) return item;
    const sourceId = index % 2 === 0 ? 'hh' : 'linkedin';
    return {
      ...item,
      cluster: {
        ...item.cluster,
        canonicalLocation: 'Москва',
        salary: { from: 500_000, to: 650_000, currency: '₽' },
        isRemote: index % 2 === 0,
        descriptionSummary:
          index % 2 === 0
            ? item.cluster.descriptionSummary
            : `${item.cluster.descriptionSummary} Гибридный формат работы.`,
        sources: item.cluster.sources.map((source, sourceIndex) =>
          sourceIndex === 0
            ? {
                ...source,
                sourceType: sourceId === 'hh' ? 'json_api' : 'jobspy',
                sourceId,
                sourceName: sourceId === 'hh' ? 'hh.ru' : 'LinkedIn',
              }
            : source,
        ),
      },
    };
  });
}

function savedApplicationFixtures(count: number): ApplicationStub[] {
  const timestamp = '2026-10-10T00:00:00.000Z';
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      id: `saved-fixture-${sequence}`,
      candidateId: 'candidate-fixture',
      clusterId: `saved-cluster-${sequence}`,
      stage: 'saved',
      archivePreviousStage: null,
      version: 1,
      vacancy: {
        title: `Saved role ${sequence}`,
        company: `Saved company ${sequence}`,
        url: `https://example.test/saved/${sequence}`,
        source: 'fixture',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

export async function mockSignedInCabinet(
  page: Page,
  options: MockSignedInCabinetOptions = {},
): Promise<string[]> {
  const unmatched: string[] = [];
  let applications = savedApplicationFixtures(options.savedVacanciesCount ?? 0);
  let nextApplicationId = 1;
  const connectionState = createMockConnectionState();

  type MockConnectionContact = Record<string, unknown> & {
    readonly id: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };

  type MockConnectionState = {
    readonly contacts: Map<string, MockConnectionContact>;
    importReceipt: {
      state: 'unknown' | 'imported';
      importedAt: string | null;
      importedCount: number | null;
    };
  };

  function createMockConnectionState(): MockConnectionState {
    return {
      contacts: new Map(),
      importReceipt: { state: 'unknown', importedAt: null, importedCount: null },
    };
  }

  async function mockConnectionRoutes(
    route: Route,
    url: URL,
    state: MockConnectionState,
  ): Promise<boolean> {
    const path = url.pathname;
    if (path === '/api/v1/candidate/connection-contacts') {
      return mockConnectionContactList(route, url, state);
    }
    if (path === '/api/v1/candidate/connection-contacts/linkedin-import') {
      return mockConnectionImport(route, state);
    }
    const contact = path.match(/^\/api\/v1\/candidate\/connection-contacts\/([^/]+)$/u);
    if (contact) return mockConnectionMutation(route, decodeURIComponent(contact[1]!), state);
    const circles = path.match(/^\/api\/v1\/candidate\/vacancies\/([^/]+)\/connection-circles$/u);
    if (circles) return mockConnectionCircles(route, decodeURIComponent(circles[1]!), state);
    return false;
  }

  async function mockConnectionContactList(
    route: Route,
    url: URL,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() !== 'GET') return false;
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const contacts = Array.from(state.contacts.values());
    const items = contacts.slice(offset, offset + limit);
    return route
      .fulfill({
        json: {
          data: {
            items,
            total: contacts.length,
            offset,
            limit,
            nextOffset: offset + items.length < contacts.length ? offset + items.length : null,
            linkedinImport: state.importReceipt,
          },
        },
      })
      .then(() => true);
  }

  async function mockConnectionImport(route: Route, state: MockConnectionState): Promise<boolean> {
    if (route.request().method() !== 'PUT') return false;
    const body = route.request().postDataJSON() as { contacts?: Array<Record<string, unknown>> };
    const importedAt = '2026-10-10T12:00:00.000Z';
    for (const [id, contact] of state.contacts) {
      if (contact.source === 'linkedin_import') state.contacts.delete(id);
    }
    for (const [index, contact] of (body.contacts ?? []).entries()) {
      const id = String(contact.externalId ?? contact.linkedinUrl ?? `imported-${index + 1}`);
      state.contacts.set(id, {
        ...contact,
        id,
        source: 'linkedin_import',
        createdAt: importedAt,
        updatedAt: importedAt,
      });
    }
    state.importReceipt = {
      state: 'imported',
      importedAt,
      importedCount: (body.contacts ?? []).length,
    };
    return route.fulfill({ json: { data: state.importReceipt } }).then(() => true);
  }

  async function mockConnectionMutation(
    route: Route,
    id: string,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() === 'DELETE') {
      const contact = state.contacts.get(id);
      if (contact?.source === 'linkedin_import') {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'connection_contact_read_only' } },
        });
        return true;
      }
      if (contact?.source === 'manual') state.contacts.delete(id);
      await route.fulfill({ status: 204 });
      return true;
    }
    if (route.request().method() !== 'PUT') return false;
    const previous = state.contacts.get(id);
    const now = '2026-10-10T12:00:00.000Z';
    const contact = {
      ...(route.request().postDataJSON() as Record<string, unknown>),
      id,
      source: 'manual',
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    state.contacts.set(id, contact);
    await route.fulfill({ status: previous ? 200 : 201, json: { data: contact } });
    return true;
  }

  async function mockConnectionCircles(
    route: Route,
    vacancyId: string,
    state: MockConnectionState,
  ): Promise<boolean> {
    if (route.request().method() !== 'GET') return false;
    const knownState = state.importReceipt.state === 'imported' ? 'none' : 'unknown';
    await route.fulfill({
      json: {
        data: {
          vacancyId,
          circles: [
            { circle: 1, state: knownState, paths: [] },
            { circle: 2, state: knownState, paths: [] },
            { circle: 3, state: 'available', paths: [{ nextStep: 'cold_application' }] },
          ],
          linkedinImport: state.importReceipt,
        },
      },
    });
    return true;
  }

  const applicationLabels: Array<{ id: string; name: string; createdAt: string }> = [];
  const companyWants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }> = [];
  const applicationOperationResults = new Map<
    string,
    { fingerprint: string; result: Record<string, unknown> }
  >();
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (await mockConnectionRoutes(route, url, connectionState)) return;
    if (
      route.request().method() === 'POST' &&
      /\/api\/v1\/candidate\/vacancies\/[^/]+\/letter-approvals$/u.test(path)
    ) {
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
    }
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { data: { ...candidate, emailVerified: true } } });
    }
    if (path.endsWith('/candidate/workspace')) {
      return route.fulfill({ json: { data: workspace } });
    }
    if (path.endsWith('/candidate/today')) {
      const existingMomentum =
        'momentum' in todaySnapshot
          ? (todaySnapshot as { momentum?: unknown }).momentum
          : undefined;
      const snapshotWithMomentum = {
        ...todaySnapshot,
        momentum: existingMomentum ?? {
          calculatedAt: '2026-10-09T12:00:00.000Z',
          windows: {
            '7d': { applied: 4, views: 'unknown', screenings: 'unknown', interviews: 1 },
            '30d': { applied: 14, views: 'unknown', screenings: 'unknown', interviews: 2 },
          },
          burnoutNotice: false,
        },
      };
      return route.fulfill({ json: { data: snapshotWithMomentum } });
    }
    // Saved vacancies use the same candidate application tracker as the Responses screen.
    if (path === '/api/v1/candidate/applications') {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: applications } });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          clusterId?: string;
          stage?: string;
          manualVacancy?: unknown;
        };
        const timestamp = '2026-10-10T00:00:00.000Z';
        const created: ApplicationStub = {
          id: `application-${nextApplicationId++}`,
          candidateId: 'candidate-fixture',
          clusterId: body.clusterId ?? null,
          stage: body.stage ?? 'saved',
          archivePreviousStage: null,
          version: 1,
          vacancy: body.manualVacancy ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        applications = [...applications, created];
        return route.fulfill({ status: 201, json: { data: created } });
      }
    }
    const applicationRoute = path.match(
      /^\/api\/v1\/candidate\/applications\/([^/]+)(\/restore)?$/u,
    );
    if (applicationRoute && route.request().method() === 'PATCH') {
      const record = applications.find(
        (item) => item.id === decodeURIComponent(applicationRoute[1]!),
      );
      if (!record) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      const body = route.request().postDataJSON() as { stage?: string };
      if (body.stage === 'archived') record.archivePreviousStage = record.stage;
      if (body.stage) record.stage = body.stage;
      record.version += 1;
      record.updatedAt = '2026-10-10T00:01:00.000Z';
      return route.fulfill({ json: { data: record } });
    }
    if (
      applicationRoute &&
      route.request().method() === 'POST' &&
      applicationRoute[2] === '/restore'
    ) {
      const record = applications.find(
        (item) => item.id === decodeURIComponent(applicationRoute[1]!),
      );
      if (!record) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      record.stage = record.archivePreviousStage ?? 'saved';
      record.archivePreviousStage = null;
      record.version += 1;
      record.updatedAt = '2026-10-10T00:02:00.000Z';
      return route.fulfill({ json: { data: record } });
    }
    if (path.endsWith('/candidate/application-labels')) {
      if (route.request().method() === 'POST') {
        const name = String(route.request().postDataJSON().name ?? '')
          .trim()
          .replace(/\s+/gu, ' ');
        const existing = applicationLabels.find(
          (label) => label.name.toLocaleLowerCase('und') === name.toLocaleLowerCase('und'),
        );
        const label = existing ?? {
          id: `mock-label-${applicationLabels.length + 1}`,
          name,
          createdAt: new Date().toISOString(),
        };
        if (!existing) applicationLabels.push(label);
        return route.fulfill({ status: existing ? 200 : 201, json: { data: label } });
      }
      return route.fulfill({ json: { data: applicationLabels } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk/preview')) {
      const body = route.request().postDataJSON();
      const wanted = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<{ companyName: string }>)
        : [];
      const affectedCount = companies.filter((company) =>
        body.action === 'add'
          ? !wanted.has(company.companyName.toLocaleLowerCase('und'))
          : wanted.has(company.companyName.toLocaleLowerCase('und')),
      ).length;
      return route.fulfill({ json: { data: { affectedCount } } });
    }
    if (path.endsWith('/candidate/applications/company-wants/bulk')) {
      const body = route.request().postDataJSON();
      const replay = applicationOperationResults.get(String(body.operationId));
      const fingerprint = JSON.stringify({
        action: body.action,
        companies: body.companies,
        confirmCount: body.confirmCount,
      });
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      const companies = Array.isArray(body.companies)
        ? (body.companies as Array<Record<string, unknown>>)
        : [];
      const keys = new Set(
        companyWants.map((company) => company.companyName.toLocaleLowerCase('und')),
      );
      const targets = companies.filter((company) => {
        const exists = keys.has(String(company.companyName).toLocaleLowerCase('und'));
        return body.action === 'add' ? !exists : exists;
      });
      if (Number(body.confirmCount) !== targets.length) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'bulk_confirmation_count_changed',
              details: { affectedCount: targets.length },
            },
          },
        });
      }
      for (const company of targets)
        applyMockCompanyWant(companyWants, company, String(body.action));
      const result = { state: 'completed', changedCount: targets.length };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (path.endsWith('/candidate/applications/company-wants')) {
      return route.fulfill({ json: { data: companyWants } });
    }
    if (path.endsWith('/candidate/applications/bulk/preview')) {
      return route.fulfill({ json: { data: { affectedCount: 0 } } });
    }
    if (path.endsWith('/candidate/applications/bulk')) {
      const body = route.request().postDataJSON();
      const fingerprint = JSON.stringify({
        filters: body.filters,
        action: body.action,
        confirmCount: body.confirmCount,
      });
      const replay = applicationOperationResults.get(String(body.operationId));
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          return route.fulfill({
            status: 409,
            json: { error: { code: 'idempotency_key_reused' } },
          });
        return route.fulfill({ json: { data: { ...replay.result, replayed: true } } });
      }
      if (Number(body.confirmCount) !== 0) {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: 'bulk_confirmation_count_changed', details: { affectedCount: 0 } },
          },
        });
      }
      const result =
        body.action?.type === 'retry'
          ? { state: 'prepared', preparedCount: 0, sentCount: 0, changedCount: 0 }
          : { state: 'completed', changedCount: 0 };
      applicationOperationResults.set(String(body.operationId), { fingerprint, result });
      return route.fulfill({ json: { data: { ...result, replayed: false } } });
    }
    if (/\/candidate\/applications\/[^/]+\/labels\/[^/]+$/u.test(path)) {
      return route.fulfill({ status: 404, json: { error: { code: 'application_not_found' } } });
    }
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/drafts')) {
      return route.fulfill({ json: { data: [] } });
    }
    // B370: панель отправки откликов читает лимиты и квитанции; в фикстуре действий нет.
    if (path.endsWith('/candidate/actions/usage')) {
      return route.fulfill({
        json: {
          data: {
            usage: {
              localDate: '2026-10-01',
              hhAppliesCount: 0,
              linkedinEasyAppliesCount: 0,
              hhBoostsCount: 0,
              lastHhBoostAt: null,
            },
            timezone: 'Europe/Moscow',
            resetAt: '2026-10-01T21:00:00.000Z',
            killSwitchActive: false,
            limits: {
              maxHhAppliesPerDay: 15,
              maxLinkedinEasyAppliesPerDay: 10,
              maxHhBoostsPerDay: 3,
              minHhBoostIntervalMinutes: 240,
            },
          },
        },
      });
    }
    if (path.endsWith('/me/consents/actions_on_behalf')) {
      return route.fulfill({
        json: { data: { capability: 'actions_on_behalf', granted: false, consent: null } },
      });
    }
    if (path.endsWith('/candidate/actions/receipts')) {
      return route.fulfill({ json: { data: { receipts: [] } } });
    }
    // C64: шапка Профиля читает согласие «Вы в поиске»; в фикстуре оно не дано.
    if (path.endsWith('/candidate/search-consent')) {
      return route.fulfill({
        json: { data: { consent: { granted: false, policyVersion: '', updatedAt: '' } } },
      });
    }
    if (path.endsWith('/candidate/decision-profile')) {
      if (route.request().method() === 'PUT') {
        decisionProfile = {
          ...route.request().postDataJSON(),
          updatedAt: '2026-10-06T12:00:00.000Z',
        };
      }
      return route.fulfill({ json: { data: decisionProfile } });
    }
    if (path.endsWith('/candidate/skill-quiz/apply') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      skillQuizCommandId = route.request().headers()['idempotency-key'] ?? 'skill-quiz-command';
      skillQuizReverted = false;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const skillName = String(body.skillName ?? 'TypeScript');
      return route.fulfill({
        status: 201,
        json: {
          data: {
            commandId: skillQuizCommandId,
            command: { commandId: skillQuizCommandId },
            result: { quizId: body.quizId, statusLabel: 'подтверждён' },
            fact: {
              skillName,
              status: 'подтверждён',
              source: 'hh.ru',
              date: '2026-10-06',
              scorePercent: 100,
              statement: `${skillName}: подтверждён (hh.ru, 2026-10-06, 100%)`,
            },
          },
        },
      });
    }
    const skillQuizRevert = path.match(/\/candidate\/career-commands\/([^/]+)\/revert$/u);
    if (skillQuizRevert && route.request().method() === 'POST') {
      const commandId = decodeURIComponent(skillQuizRevert[1]!);
      if (commandId !== skillQuizCommandId) {
        return route.fulfill({
          status: 404,
          json: { error: { code: 'career_command_not_found', message: 'Команда не найдена.' } },
        });
      }
      if (skillQuizReverted) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'profile_revision_already_reverted',
              message: 'Это изменение уже отменено',
            },
          },
        });
      }
      skillQuizReverted = true;
      return route.fulfill({ json: { data: { commandId, profileRevisionReverted: true } } });
    }
    if (path.endsWith('/candidate/footprint/plan')) {
      return route.fulfill({
        json: {
          data: {
            plan: [],
            sourceAvailability: {
              sherlock: true,
              maigret: true,
              hibp: false,
              wayback: true,
              exa: false,
            },
            consent: {
              approved: false,
              granted: false,
              versionId: 'digital_footprint-v1.1',
            },
            audit: null,
          },
        },
      });
    }
    if (path.endsWith('/candidate/footprint')) {
      return route.fulfill({ json: { data: { audit: null } } });
    }
    if (path.endsWith('/candidate/visits') && route.request().method() === 'POST') {
      return route.fulfill({ json: { data: { since: null } } });
    }
    if (path.endsWith('/candidate/me')) {
      return route.fulfill({
        json: {
          data: candidateSnapshot,
          meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
        },
      });
    }
    if (path.endsWith('/account/sessions') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { revoked: 2 } } });
    }
    if (path.endsWith('/candidate/export')) {
      return route.fulfill({ json: { data: { profile: account.profile } } });
    }
    if (path.endsWith('/candidate/me') && route.request().method() === 'DELETE') {
      return route.fulfill({ json: { data: { deleted: true } } });
    }
    if (path.endsWith('/candidate/consultant-history')) {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const historyConversation = path.match(
      /\/candidate\/consultant-history\/([^/]+)(?:\/messages)?$/u,
    );
    if (historyConversation) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'conversation_read_only',
              message: 'Продолжить беседу из истории нельзя.',
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            id: decodeURIComponent(historyConversation[1]!),
            stage: 'profile',
            openedAt: '2026-10-01T10:00:00.000Z',
            lastMessageAt: '2026-10-01T10:05:00.000Z',
            closedAt: '2026-10-01T10:06:00.000Z',
            messageCount: 2,
            firstPhrase: 'Расскажите о вашем опыте.',
            summary: null,
            messages: [],
          },
        },
      });
    }
    if (path.endsWith('/account')) {
      return route.fulfill({ json: { data: account } });
    }
    if (
      path.endsWith('/candidate/me/memory') ||
      path.endsWith('/candidate/me/turns') ||
      path.endsWith('/candidate/me/messages')
    ) {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path.endsWith('/candidate/role-hypotheses')) {
      return route.fulfill({ json: { data: roleHypotheses } });
    }
    if (path.endsWith('/candidate/resume')) {
      // B248, owner review 2026-09-23 — this shape used to disagree with
      // `ResumeStudioProjection`/`ResumeEvidenceFreshness`
      // (`server/domain/resumeStudioTypes.ts`): `evidenceFreshness.stale`
      // is an array the surface calls `.length` on, not a boolean, and it
      // crashed into the error boundary the moment «Профиль» started
      // opening this screen instead of a copy of «Сегодня». The client
      // rebuilds its own projection from the draft and never reads this
      // one, but the shape still has to be honest.
      const emptyDocument = {
        kind: 'master',
        targetRole: null,
        contact: { fullName: null, email: null, phone: null, location: null, links: [] },
        experience: [],
        education: [],
        languages: [],
        unknowns: [],
        conventions: {
          country: null,
          packVersion: null,
          reverseChronological: true,
          maxPages: null,
          recommendedBulletsPerRole: null,
          photo: 'omitted',
          discriminatoryPii: 'omitted',
        },
        length: { lines: 0, pages: 1, linesPerPage: 45 },
      };
      return route.fulfill({
        json: {
          data: {
            draft: candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: candidateSnapshot.resume.createdAt,
              updatedAt: candidateSnapshot.resume.updatedAt,
            },
            projection: {
              master: emptyDocument,
              germanyVariant: { ...emptyDocument, kind: 'country-role' },
              evidenceSnapshot: [],
              excludedEvidenceIds: [],
            },
            evidenceFreshness: { valid: true, stale: [] },
          },
        },
      });
    }
    if (path.endsWith('/candidate/matched-vacancies')) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const page = matchedVacancyPage(offset, options.vacancyTotal);
      return route.fulfill({
        json: {
          ...page,
          ...(offset === 0 && options.vacancyInitialFilters
            ? { data: seedInitialVacancyItems(page.data) }
            : {}),
          meta: {
            ...page.meta,
            ...(options.vacancyFacets ? { facets: options.vacancyFacets } : {}),
            ...(offset === 0 && options.vacancyInitialFilters
              ? { initialFilters: options.vacancyInitialFilters }
              : {}),
          },
        },
      });
    }
    if (
      path.endsWith('/candidate/vacancy-subscriptions') ||
      path.endsWith('/candidate/vacancy-sources') ||
      path.endsWith('/candidate/vacancy-applications') ||
      path.endsWith('/candidate/connections') ||
      path.endsWith('/candidate/career-commands')
    ) {
      return route.fulfill({ json: { data: [] } });
    }
    if (
      path.endsWith('/candidate/strategy') ||
      path.endsWith('/candidate/work-preferences') ||
      path.endsWith('/candidate/reputation-audit') ||
      path.endsWith('/candidate/desktop-tunnel')
    ) {
      return route.fulfill({ json: { data: null } });
    }
    unmatched.push(path);
    return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await mockCandidateCompanies(page, { companyCount: options.companyCount });
  return unmatched;
}

function applyMockCompanyWant(
  wants: Array<{
    companyKey: string;
    companyName: string;
    nextStep: string | null;
    nextStepDueAt: string | null;
    updatedAt: string;
  }>,
  company: Record<string, unknown>,
  action: string,
): void {
  const companyName = String(company.companyName ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
  const normalized = companyName.normalize('NFKC').toLocaleLowerCase('und');
  const index = wants.findIndex(
    (want) => want.companyName.normalize('NFKC').toLocaleLowerCase('und') === normalized,
  );
  if (action === 'add' && index < 0) {
    wants.push({
      companyKey: `mock:${normalized}`,
      companyName,
      nextStep: null,
      nextStepDueAt: null,
      updatedAt: new Date().toISOString(),
    });
  }
  if (action === 'set_next_step' && index >= 0) {
    wants[index]!.nextStep = String(company.nextStep ?? '');
    wants[index]!.nextStepDueAt = company.nextStepDueAt ? String(company.nextStepDueAt) : null;
    wants[index]!.updatedAt = new Date().toISOString();
  }
  if (action === 'remove' && index >= 0) wants.splice(index, 1);
}
