import type { Page, Route } from '@playwright/test';
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

interface AutomationFixtureState {
  settings: {
    candidateId: string;
    enabled: boolean;
    mode: string;
    pausedUntil: string | null;
    rules: Record<string, unknown>;
    updatedAt: string | null;
  };
  consents: Array<Record<string, unknown>>;
  stops: Array<{ company: string; origin: string; createdAt: string }>;
  queue: AutomationQueueFixtureItem[];
}

interface AutomationQueueFixtureItem {
  id: string;
  status: string;
  sendTiming: string;
  payload: {
    clusterId: string;
    applicationId: string | null;
    platform: string;
    title: string;
    role: string;
    company: string;
    targetUrl: string;
    requirements: { matched: number; total: number };
    letterText: string;
    materials: Array<{ documentId: string; kind: string; fileName: string; version: number }>;
  };
}

const AUTOMATION_CONSENT_TEXT: Readonly<Record<string, string>> = {
  drafts: 'Разрешаю готовить черновики откликов и писем по выбранным мной вакансиям.',
  send_after_approval: 'Разрешаю отправлять каждый отклик только после моего отдельного одобрения.',
  notifications: 'Разрешаю показывать очередь и журнал автооткликов в уведомлениях приложения.',
  automatic_submission:
    'Разрешаю отправлять подходящие отклики без отдельного одобрения каждого, в рамках выбранных правил и тарифных лимитов.',
};

function createAutomationFixtureState(): AutomationFixtureState {
  return {
    settings: {
      candidateId: 'readability-candidate',
      enabled: false,
      mode: 'drafts_only',
      pausedUntil: null,
      rules: {
        roles: [],
        minimumMatchPercent: 80,
        platforms: ['hh', 'linkedin'],
        excludeStopCompanies: true,
      },
      updatedAt: null,
    },
    consents: [],
    stops: [],
    queue: [],
  };
}

function automationState(state: AutomationFixtureState) {
  const queueCounts = Object.fromEntries(
    [
      'letter_not_ready',
      'pending_approval',
      'approved',
      'removed',
      'consultant',
      'sent',
      'attempted',
      'failed',
    ].map((status) => [status, state.queue.filter((item) => item.status === status).length]),
  );
  return {
    settings: state.settings,
    consents: state.consents,
    stopCompanies: state.stops,
    queueCounts,
    linkedinPublishing: { enabled: false, reason: 'Публикацию в LinkedIn запускает кандидат.' },
  };
}

function applyAutomationAction(
  state: AutomationFixtureState,
  item: AutomationQueueFixtureItem,
  action: string,
): void {
  item.status =
    action === 'approve_and_send' ? 'approved' : action === 'consultant' ? 'consultant' : 'removed';
  if (action === 'stop_company') {
    const company = item.payload.company;
    state.stops = [
      ...state.stops.filter((stop) => stop.company !== company),
      { company, origin: 'manual', createdAt: new Date().toISOString() },
    ];
    state.queue
      .filter((queued) => queued.payload.company === company && queued.status !== 'sent')
      .forEach((queued) => {
        queued.status = 'removed';
        queued.payload = { ...queued.payload, targetUrl: '', letterText: '', materials: [] };
      });
  }
  if (item.status === 'removed')
    item.payload = { ...item.payload, targetUrl: '', letterText: '', materials: [] };
}

async function mockAutomationConfiguration(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation') && method === 'GET') {
    await route.fulfill({ json: { data: automationState(state) } });
    return true;
  }
  if (path.endsWith('/candidate/automation/enable') && method === 'POST') {
    const body = route.request().postDataJSON() as {
      mode: string;
      rules?: Record<string, unknown>;
      consentKeys: string[];
    };
    const acceptedAt = new Date().toISOString();
    state.settings = {
      ...state.settings,
      enabled: true,
      mode: body.mode,
      rules: body.rules ?? state.settings.rules,
      updatedAt: acceptedAt,
    };
    state.consents = body.consentKeys.map((key) => ({
      id: `consent-${key}`,
      key,
      version: 'B452-2026-10-10-v1',
      text: AUTOMATION_CONSENT_TEXT[key] ?? '',
      acceptedAt,
      revokedAt: null,
    }));
    await route.fulfill({ json: { data: automationState(state) } });
    return true;
  }
  if (path.endsWith('/candidate/automation/disable') && method === 'POST') {
    state.settings = { ...state.settings, enabled: false };
    state.queue
      .filter((item) => item.status === 'approved')
      .forEach((item) => {
        item.status = 'pending_approval';
      });
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  return updateAutomationConfiguration(route, path, state);
}

async function updateAutomationConfiguration(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation/rules') && method === 'PUT') {
    state.settings = {
      ...state.settings,
      rules: route.request().postDataJSON(),
      updatedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/pause') && method === 'POST') {
    const { days } = route.request().postDataJSON() as { days: number };
    state.settings = {
      ...state.settings,
      pausedUntil: new Date(Date.now() + days * 86_400_000).toISOString(),
    };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  if (path.endsWith('/candidate/automation/pause') && method === 'DELETE') {
    state.settings = { ...state.settings, pausedUntil: null };
    await route.fulfill({ json: { data: { settings: state.settings } } });
    return true;
  }
  const revoke = path.match(/\/candidate\/automation\/consents\/([^/]+)\/revoke$/u);
  if (!revoke || method !== 'POST') return false;
  const key = decodeURIComponent(revoke[1]!);
  state.consents = state.consents.map((consent) =>
    consent.key === key ? { ...consent, revokedAt: new Date().toISOString() } : consent,
  );
  state.settings = { ...state.settings, enabled: false };
  state.queue
    .filter((item) => item.status === 'approved')
    .forEach((item) => {
      item.status = 'pending_approval';
    });
  await route.fulfill({ json: { data: { revoked: true, ...automationState(state) } } });
  return true;
}

async function mockAutomationQueue(
  route: Route,
  path: string,
  url: URL,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (path.endsWith('/candidate/automation/queue/refresh') && method === 'POST') {
    const body = route.request().postDataJSON() as { opportunities?: unknown[] };
    await route.fulfill({
      json: { data: { added: 0, skipped: body.opportunities?.length ?? 0, items: [] } },
    });
    return true;
  }
  if (path.endsWith('/candidate/automation/queue/bulk') && method === 'POST') {
    return bulkAutomationQueue(route, state);
  }
  if (path.endsWith('/candidate/automation/queue') && method === 'GET') {
    const status = url.searchParams.get('status');
    const platform = url.searchParams.get('platform');
    const items = state.queue.filter(
      (item) =>
        (!status || item.status === status) && (!platform || item.payload.platform === platform),
    );
    await route.fulfill({
      json: {
        data: {
          items,
          total: items.length,
          limit: Number(url.searchParams.get('limit') ?? 20),
          offset: Number(url.searchParams.get('offset') ?? 0),
        },
      },
    });
    return true;
  }
  return mockAutomationQueueItem(route, path, state);
}

async function bulkAutomationQueue(route: Route, state: AutomationFixtureState): Promise<boolean> {
  const { filter, action } = route.request().postDataJSON() as {
    filter: { status: string; platform?: string };
    action: string;
  };
  const selected = state.queue.filter(
    (item) =>
      item.status === filter.status &&
      (!filter.platform || item.payload.platform === filter.platform),
  );
  selected.forEach((item) => applyAutomationAction(state, item, action));
  await route.fulfill({ json: { data: { matched: selected.length, updated: selected.length } } });
  return true;
}

async function mockAutomationQueueItem(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const actionMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/actions$/u);
  const letterMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/letter$/u);
  const previewMatch = path.match(/\/candidate\/automation\/queue\/([^/]+)\/preview$/u);
  const match = actionMatch ?? letterMatch ?? previewMatch;
  if (!match) return false;
  const item = state.queue.find(
    (candidateItem) => candidateItem.id === decodeURIComponent(match[1]!),
  );
  if (!item) {
    await route.fulfill({
      status: 404,
      json: { error: { code: 'automation_queue_item_not_found' } },
    });
    return true;
  }
  if (actionMatch && route.request().method() === 'POST') {
    const { action } = route.request().postDataJSON() as { action: string };
    applyAutomationAction(state, item, action);
    await route.fulfill({
      json: { data: { item, execution: item.status === 'approved' ? 'scheduled' : 'not_started' } },
    });
  } else if (letterMatch && route.request().method() === 'PATCH') {
    item.payload.letterText = (route.request().postDataJSON() as { letterText: string }).letterText;
    item.status = item.payload.letterText.trim() ? 'pending_approval' : 'letter_not_ready';
    await route.fulfill({ json: { data: { item } } });
  } else {
    await route.fulfill({ json: { data: { id: item.id, status: item.status, ...item.payload } } });
  }
  return true;
}

async function mockAutomationStops(
  route: Route,
  path: string,
  state: AutomationFixtureState,
): Promise<boolean> {
  const method = route.request().method();
  if (
    path.endsWith('/candidate/automation/stop-companies/import-rejections') &&
    method === 'POST'
  ) {
    await route.fulfill({ json: { data: { imported: 0, stopCompanies: state.stops } } });
    return true;
  }
  if (!path.endsWith('/candidate/automation/stop-companies')) return false;
  if (method === 'GET') {
    await route.fulfill({ json: { data: { stopCompanies: state.stops } } });
    return true;
  }
  const { company } = route.request().postDataJSON() as { company: string };
  state.stops =
    method === 'POST'
      ? [
          ...state.stops.filter((item) => item.company !== company),
          { company, origin: 'manual', createdAt: new Date().toISOString() },
        ]
      : state.stops.filter((item) => item.company !== company);
  if (method === 'POST') {
    state.queue
      .filter(
        (item) =>
          item.payload.company === company &&
          ['letter_not_ready', 'pending_approval', 'approved'].includes(item.status),
      )
      .forEach((item) => {
        item.status = 'removed';
        item.payload = { ...item.payload, targetUrl: '', letterText: '', materials: [] };
      });
  }
  await route.fulfill({
    json: {
      data: { added: method === 'POST', removed: method === 'DELETE', stopCompanies: state.stops },
    },
  });
  return true;
}

async function mockAutomationApi(
  route: Route,
  path: string,
  url: URL,
  state: AutomationFixtureState,
): Promise<boolean> {
  if (!path.includes('/candidate/automation')) return false;
  return (
    (await mockAutomationConfiguration(route, path, state)) ||
    (await mockAutomationQueue(route, path, url, state)) ||
    (await mockAutomationStops(route, path, state))
  );
}

export async function mockSignedInCabinet(page: Page): Promise<string[]> {
  const unmatched: string[] = [];
  let decisionProfile: Record<string, unknown> | null = null;
  let skillQuizCommandId: string | null = null;
  let skillQuizReverted = false;
  const automation = createAutomationFixtureState();
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
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
    if (await mockAutomationApi(route, path, url, automation)) return;
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
