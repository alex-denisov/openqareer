import type { Page } from '@playwright/test';
import { waitForCareerShell } from './waitForCareerShell';

export const CANDIDATE = {
  username: 'responses.candidate',
  email: 'responses.candidate@example.com',
  displayName: 'Кандидат Откликов',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b251',
};

const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'Enterprise Architect',
    location: 'Дубай',
    workMode: 'hybrid' as const,
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  sessions: [],
};

const SNAPSHOT = {
  candidate: {
    id: CANDIDATE.candidateId,
    dataClass: 'synthetic',
    locale: 'ru-RU',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
  messages: [],
  memory: [],
  turns: [],
  dossier: {
    sections: [],
    confirmedCount: 3,
    proposedCount: 0,
    readiness: { complete: true, unresolvedQuestions: 0, checks: [] },
  },
  documents: [],
  assessments: [],
  germanyMarket: null,
  vacancySubscriptions: [],
};

const WORKSPACE_INPUT = {
  resumeText: 'Enterprise Architect with 15+ years scaling platform and operations organisations.',
  resumeSource: 'text' as const,
  targetDirection: 'Enterprise Architect',
  regions: ['mena', 'eu'],
  currentSituation: 'Ищу роль Enterprise Architect.',
  constraints: 'Hybrid',
  urgency: 'active' as const,
};

const CONFIRMED_EVIDENCE_ITEMS = [
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

export function application(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    candidateId: CANDIDATE.candidateId,
    clusterId: overrides.clusterId ?? null,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    ...overrides,
  };
}

export const APPLICATIONS = [
  application({
    id: 'a-1',
    stage: 'saved',
    vacancy: {
      title: 'Cloud & Infra Solution Architect',
      company: 'Sonsoft Inc',
      url: 'https://hh.ru/vacancy/1',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-2',
    stage: 'saved',
    vacancy: {
      title: 'Platform Architect',
      company: 'Nordwind',
      url: 'https://hh.ru/vacancy/2',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
  }),
  application({
    id: 'a-3',
    stage: 'applied',
    vacancy: {
      title: 'Enterprise Architect, Senior Advisor',
      company: 'Peraton',
      url: 'https://hh.ru/vacancy/3',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    followUp: {
      dueAt: '2026-09-24T00:00:00.000Z',
      urgency: 'due',
      source: 'auto',
      daysSinceContact: 6,
    },
  }),
  application({
    id: 'a-4',
    stage: 'applied',
    vacancy: {
      title: 'Business Information Architect',
      company: 'Genetec',
      url: 'https://hh.ru/vacancy/4',
      source: 'hh',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-5',
    stage: 'applied',
    vacancy: {
      title: 'VP Technology, executive search',
      company: '',
      companyHidden: true,
      url: 'https://hh.ru/vacancy/5',
      source: 'recruiter',
    },
    whoseTurn: 'company',
  }),
  application({
    id: 'a-6',
    stage: 'responded',
    vacancy: {
      title: 'Enterprise Architect Director',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
  }),
  application({
    id: 'a-7',
    stage: 'interview',
    vacancy: {
      title: 'Enterprise Architect Director — раунд 2',
      company: 'HRTx, Inc.',
      url: 'https://hh.ru/vacancy/6',
      source: 'hh',
    },
    whoseTurn: 'candidate',
    nearestInterview: {
      id: 'iv-1',
      scheduledAt: '2026-09-26T14:00:00.000Z',
      prepStatus: 'not_started',
    },
  }),
  application({
    id: 'a-8',
    stage: 'rejected',
    closedReason: null,
    vacancy: {
      title: 'Consultant',
      company: 'Pyrovio',
      url: 'https://hh.ru/vacancy/8',
      source: 'hh',
    },
    whoseTurn: null,
  }),
  application({
    id: 'a-9',
    stage: 'archived',
    closedReason: null,
    vacancy: {
      title: 'Aotearoa Board Chair',
      company: 'Orange Sky Australia',
      url: 'https://hh.ru/vacancy/9',
      source: 'hh',
    },
    whoseTurn: null,
  }),
];

export async function stubB486Session(
  page: Page,
  options: {
    readonly pendingApprovalCount?: number | null;
    readonly applications?: readonly unknown[];
    readonly unreadCount?: number;
  } = {},
): Promise<void> {
  const pendingApprovalCount = options.pendingApprovalCount ?? 0;
  const unreadCount = options.unreadCount ?? 0;
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (pathname === '/api/v1/candidate/me') return route.fulfill({ json: { data: SNAPSHOT } });
    if (pathname === '/api/v1/account') return route.fulfill({ json: { data: ACCOUNT } });
    if (pathname === '/api/v1/candidate/connections') return route.fulfill({ json: { data: [] } });
    if (pathname === '/api/v1/candidate/me/messages')
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    if (pathname === '/api/v1/candidate/workspace')
      return route.fulfill({ json: { data: WORKSPACE_INPUT } });
    if (pathname === '/api/v1/candidate/automation') {
      return route.fulfill({
        json: {
          data:
            pendingApprovalCount === null
              ? null
              : { queueCounts: { pending_approval: pendingApprovalCount } },
        },
      });
    }
    if (pathname === '/api/v1/candidate/notifications') {
      return route.fulfill({
        json: { data: notificationPage(unreadCount) },
      });
    }
    if (pathname === '/api/v1/candidate/applications') {
      return route.fulfill({ json: { data: options.applications ?? APPLICATIONS } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

function notificationPage(unreadCount: number) {
  return {
    items: Array.from({ length: unreadCount }, (_, index) => ({
      id: 'b486-notification-' + index,
      kind: 'employer_reply',
      title: 'Получен ответ по отклику',
      createdAt: '2026-10-14T09:41:00.000Z',
      readAt: null,
      action: { label: 'Отклики', href: '/app' },
    })),
    unreadCount,
    nextCursor: null,
  };
}

export async function seedB486Workspace(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storageKey, ownerKey, candidateId, workspace }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
      window.localStorage.setItem(ownerKey, candidateId);
    },
    {
      storageKey: 'candidate-workspace',
      ownerKey: 'candidate-workspace-owner',
      candidateId: CANDIDATE.candidateId,
      workspace: {
        version: 7,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        ...WORKSPACE_INPUT,
        outcomes: [],
        analysis: {
          evidenceMethodVersion: 'evidence-local-v1',
          roleMethodVersion: 'role-hypotheses-local-v1',
          evidenceItems: CONFIRMED_EVIDENCE_ITEMS,
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

export async function openB486Responses(page: Page): Promise<void> {
  await waitForCareerShell(page);
  await page.locator('button[aria-label="Отклики"]:visible').first().click();
}
