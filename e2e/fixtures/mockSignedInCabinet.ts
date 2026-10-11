import type { Page } from '@playwright/test';
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
import type { ResumeDraft } from '../../server/domain/resumeDraft';

export interface MockCareerDiaryFixture {
  overview: Record<string, unknown>;
  goals: Array<Record<string, unknown> & { id: string }>;
  workplace: (Record<string, unknown> & { id: string }) | null;
  workplaces?: Array<Record<string, unknown> & { id: string }>;
  profileExperience?: Record<string, unknown> & { id: string };
  createdByIdempotencyKey?: Record<string, string>;
}

export interface MockSignedInCabinetOptions {
  readonly careerDiary?: MockCareerDiaryFixture;
}

async function mockEmptyCareerDiaryRoutes(
  route: Route,
  path: string,
  base: string,
): Promise<boolean> {
  if (route.request().method() !== 'GET') {
    await route.fulfill({
      status: 501,
      json: {
        error: {
          code: 'career_diary_write_not_stubbed',
          message: 'Запись дневника не настроена в этой браузерной фикстуре.',
        },
      },
    });
    return true;
  }
  if (path === base) {
    await route.fulfill({
      json: {
        data: {
          asOf: '2026-10-10',
          primaryWorkplace: null,
          summary: {
            goalsAchieved: 0,
            goalsAtRisk: 0,
            goalsTotal: 0,
            achievementsReadyToAdd: 0,
            weeklyReviewsTotal: 0,
            weeklyReviewsInRow: 0,
          },
        },
      },
    });
    return true;
  }
  if (
    [`${base}/goals`, `${base}/reviews`, `${base}/achievements`, `${base}/workplaces`].includes(
      path,
    ) ||
    (path.startsWith(`${base}/goals/`) && path.endsWith('/measurements'))
  ) {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  await route.fulfill({ status: 404, json: { error: { code: 'diary_entry_not_found' } } });
  return true;
}

async function mockCareerDiaryFixtureRoutes(
  route: Route,
  path: string,
  base: string,
  fixture: MockCareerDiaryFixture,
): Promise<boolean> {
  const method = route.request().method();
  if (path === base && method === 'GET') {
    await route.fulfill({ json: { data: fixture.overview } });
    return true;
  }
  if (path === `${base}/goals` && method === 'GET') {
    await route.fulfill({ json: { data: { items: fixture.goals, nextCursor: null } } });
    return true;
  }
  if (path === `${base}/workplaces` && method === 'GET') {
    const items = mockCareerDiaryWorkplaces(fixture);
    await route.fulfill({ json: { data: { items, nextCursor: null } } });
    return true;
  }
  if (path.startsWith(`${base}/goals/`) && path.endsWith('/measurements') && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/reviews` && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/achievements` && method === 'GET') {
    await route.fulfill({ json: { data: { items: [], nextCursor: null } } });
    return true;
  }
  if (path === `${base}/workplaces` && method === 'POST') {
    return mockCreateWorkplace(route, fixture);
  }
  const primaryId = routeWorkplaceActionId(path, base, 'primary');
  if (primaryId) return mockSetPrimaryWorkplace(route, method, fixture, primaryId);
  const archiveId = routeWorkplaceActionId(path, base, 'archive');
  if (archiveId) return mockArchiveWorkplace(route, method, fixture, archiveId);
  const workplaceId = routeResourceId(path, base, 'workplaces');
  if (workplaceId !== null) return mockWorkplaceRequest(route, method, fixture, workplaceId);
  const goalId = routeResourceId(path, base, 'goals');
  if (goalId !== null) return mockGoalRequest(route, method, fixture, goalId);
  await route.fulfill({ status: 404, json: { error: { code: 'diary_entry_not_found' } } });
  return true;
}

function routeResourceId(path: string, base: string, collection: string): string | null {
  const prefix = `${base}/${collection}/`;
  if (!path.startsWith(prefix)) return null;
  const encodedId = path.slice(prefix.length);
  if (!encodedId || encodedId.includes('/')) return null;
  return decodeURIComponent(encodedId);
}

function routeWorkplaceActionId(
  path: string,
  base: string,
  action: 'primary' | 'archive',
): string | null {
  const prefix = `${base}/workplaces/`;
  const suffix = `/${action}`;
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const encodedId = path.slice(prefix.length, -suffix.length);
  return encodedId && !encodedId.includes('/') ? decodeURIComponent(encodedId) : null;
}

function mockCareerDiaryWorkplaces(
  fixture: MockCareerDiaryFixture,
): Array<Record<string, unknown> & { id: string }> {
  if (fixture.workplaces) return fixture.workplaces;
  fixture.workplaces = fixture.workplace ? [fixture.workplace] : [];
  return fixture.workplaces;
}

function mockProfileSnapshot(fixture?: MockCareerDiaryFixture) {
  const snapshot = structuredClone(candidateSnapshot);
  const experience = fixture?.profileExperience;
  if (experience && snapshot.resume) {
    snapshot.resume = {
      ...snapshot.resume,
      draft: {
        ...snapshot.resume.draft,
        experience: [experience as unknown as ResumeDraft['experience'][number]],
      },
    };
  }
  return snapshot;
}

async function mockWorkplaceRequest(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const index = workplaces.findIndex((item) => item.id === workplaceId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  if (method === 'GET') {
    await route.fulfill({ json: { data: workplaces[index] } });
    return true;
  }
  if (method !== 'PATCH') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const patch = route.request().postDataJSON() as Record<string, unknown>;
  if (workplaces[index]?.status === 'archived' && 'planning' in patch) {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'career_diary_workplace_archived' } },
    });
    return true;
  }
  workplaces[index] = { ...workplaces[index]!, ...patch };
  if (fixture.workplace?.id === workplaceId) {
    fixture.workplace = workplaces[index]!;
    fixture.overview = { ...fixture.overview, primaryWorkplace: fixture.workplace };
  }
  await route.fulfill({ json: { data: workplaces[index] } });
  return true;
}

async function mockCreateWorkplace(
  route: Route,
  fixture: MockCareerDiaryFixture,
): Promise<boolean> {
  const input = route.request().postDataJSON() as Record<string, unknown>;
  const key = route.request().headers()['idempotency-key'] ?? '';
  const existingId = fixture.createdByIdempotencyKey?.[key];
  if (existingId) {
    const existing = mockCareerDiaryWorkplaces(fixture).find((item) => item.id === existingId);
    if (existing) {
      await route.fulfill({ json: { data: existing } });
      return true;
    }
  }
  const id = `workplace-created-${mockCareerDiaryWorkplaces(fixture).length + 1}`;
  const workplace = {
    id,
    company: String(input.company ?? ''),
    title: String(input.title ?? ''),
    startDate: String(input.startDate ?? ''),
    endDate: null,
    sourceExperienceId: null,
    status: 'active',
    isPrimary: false,
    createdAt: '2026-12-06T12:00:00.000Z',
    updatedAt: '2026-12-06T12:00:00.000Z',
  };
  mockCareerDiaryWorkplaces(fixture).push(workplace);
  fixture.createdByIdempotencyKey = { ...fixture.createdByIdempotencyKey, [key]: id };
  await route.fulfill({ status: 201, json: { data: workplace } });
  return true;
}

async function mockSetPrimaryWorkplace(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  if (method !== 'PUT') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const selected = workplaces.find((item) => item.id === workplaceId);
  if (!selected) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  fixture.workplaces = workplaces.map((item) => ({ ...item, isPrimary: item.id === workplaceId }));
  fixture.workplace = fixture.workplaces.find((item) => item.id === workplaceId) ?? null;
  fixture.overview = { ...fixture.overview, primaryWorkplace: fixture.workplace };
  await route.fulfill({ json: { data: fixture.workplace } });
  return true;
}

async function mockArchiveWorkplace(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  workplaceId: string,
): Promise<boolean> {
  if (method !== 'PUT') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const workplaces = mockCareerDiaryWorkplaces(fixture);
  const index = workplaces.findIndex((item) => item.id === workplaceId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  workplaces[index] = {
    ...workplaces[index]!,
    status: 'archived',
    endDate: '2026-12-06',
    isPrimary: false,
  };
  if (fixture.workplace?.id === workplaceId) {
    fixture.workplace = null;
    fixture.overview = { ...fixture.overview, primaryWorkplace: null };
  }
  await route.fulfill({ json: { data: workplaces[index] } });
  return true;
}

async function mockGoalRequest(
  route: Route,
  method: string,
  fixture: MockCareerDiaryFixture,
  goalId: string,
): Promise<boolean> {
  const index = fixture.goals.findIndex((goal) => goal.id === goalId);
  if (index < 0) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'career_diary_record_not_found' } },
    });
    return true;
  }
  if (method === 'GET') {
    await route.fulfill({ json: { data: fixture.goals[index] } });
    return true;
  }
  if (method !== 'PATCH') {
    await route.fulfill({ status: 405, json: { error: { code: 'method_not_allowed' } } });
    return true;
  }
  const patch = route.request().postDataJSON() as Record<string, unknown>;
  fixture.goals[index] = { ...fixture.goals[index]!, ...patch };
  await route.fulfill({ json: { data: fixture.goals[index] } });
  return true;
}

async function mockCareerDiaryRoutes(
  route: Route,
  path: string,
  fixture?: MockCareerDiaryFixture,
): Promise<boolean> {
  const base = '/api/v1/candidate/career-diary';
  if (!path.startsWith(base)) return false;
  if (!fixture) return mockEmptyCareerDiaryRoutes(route, path, base);
  return mockCareerDiaryFixtureRoutes(route, path, base, fixture);
}

export async function mockSignedInCabinet(
  page: Page,
  options: MockSignedInCabinetOptions = {},
): Promise<string[]> {
  const unmatched: string[] = [];
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  const careerDiary = options.careerDiary ? structuredClone(options.careerDiary) : undefined;
  const profileSnapshot = mockProfileSnapshot(careerDiary);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (await mockCareerDiaryRoutes(route, path, careerDiary)) return;
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
    // The readability fixture has no tracked applications yet; an empty
    // list is the honest state, not an unknown route.
    if (path.endsWith('/candidate/applications') || path.endsWith('/candidate/drafts')) {
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
          data: profileSnapshot,
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
            draft: profileSnapshot.resume?.draft ?? candidateSnapshot.resume.draft,
            savedAt: {
              createdAt: profileSnapshot.resume?.createdAt ?? candidateSnapshot.resume.createdAt,
              updatedAt: profileSnapshot.resume?.updatedAt ?? candidateSnapshot.resume.updatedAt,
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
      return route.fulfill({
        json: matchedVacancyPage(Number(url.searchParams.get('offset') ?? 0)),
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
  await mockCandidateCompanies(page);
  return unmatched;
}
