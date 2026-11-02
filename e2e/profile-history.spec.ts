import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { previewProjection } from '../src/features/resume/resumeStudioModel';
import type { ProfileHistoryItem } from '../src/features/resume/profileHistoryApi';

/**
 * 01.11 — «Принять» confirms the career data (badge with the consultant date)
 * and Profile has «История изменений» at 1440 and 390.
 */

const EVIDENCE_DIR = e2eEvidenceDirectory('profile-history');
test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

const CANDIDATE = {
  username: 'history.candidate',
  email: 'history.candidate@example.com',
  displayName: 'Марина Соколова',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-profile-history',
};
const ACCOUNT = {
  username: CANDIDATE.username,
  email: CANDIDATE.email,
  displayName: CANDIDATE.displayName,
  profile: {
    headline: 'VP of Engineering',
    location: 'Берлин',
    workMode: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  sessions: [],
};
const ACCEPTED_AT = '2026-11-01T09:30:00.000Z';

function fact(id: string, statement: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'fact' as const,
    domain: 'responsibility' as const,
    statement,
    confidence: 'candidate-confirmed' as const,
    sourceMessageIds: [],
    sensitive: false,
    status: 'confirmed' as const,
    ...extra,
  };
}

const MEMORY = [
  fact('mem-a', 'Сократила время релиза с 3 недель до 2 дней.', {
    consultantConfirmedAt: ACCEPTED_AT,
  }),
  fact('mem-b', 'Отвечаю за платформу для 6 продуктовых команд.', {
    consultantConfirmedAt: ACCEPTED_AT,
  }),
  fact('mem-c', 'Собрала три платформенные команды с нуля.', {
    confidence: 'candidate-reported',
    status: 'proposed',
  }),
];

const DRAFT = {
  schemaVersion: 2,
  candidate: { fullName: 'Марина Соколова', headline: 'VP of Engineering' },
  targetRole: 'VP of Engineering',
  experience: [
    {
      id: 'exp-1',
      chronologyMemoryId: 'mem-exp-1',
      title: 'VP of Engineering',
      employer: 'FinNova Bank',
      startDate: 'янв 2023',
      current: true,
      bulletMemoryIds: ['mem-a', 'mem-b'],
    },
    {
      id: 'exp-2',
      chronologyMemoryId: 'mem-exp-2',
      title: 'Director of Engineering',
      employer: 'PayGrid',
      startDate: 'июн 2019',
      endDate: 'дек 2022',
      current: false,
      bulletMemoryIds: ['mem-c'],
    },
  ],
  education: [],
  languages: [],
};

const HISTORY: ProfileHistoryItem[] = [
  {
    id: 'h1',
    actor: 'consultant',
    section: 'experience',
    kind: 'value',
    itemId: 'mem-a',
    label: 'VP of Engineering · FinNova Bank',
    previousText: 'Ускорила релизы.',
    appliedText: 'Сократила время релиза с 3 недель до 2 дней.',
    createdAt: ACCEPTED_AT,
    revertedAt: null,
  },
  {
    id: 'h4',
    actor: 'consultant',
    section: 'skills',
    kind: 'value',
    itemId: 'itil',
    label: 'ITIL',
    previousText: '',
    appliedText: 'Навык ITIL — подтверждён проверкой',
    createdAt: '2026-10-31T13:06:00.000Z',
    revertedAt: null,
  },
  {
    id: 'h2',
    actor: 'candidate',
    section: 'headline',
    kind: 'value',
    itemId: null,
    label: '',
    previousText: 'Head of Engineering',
    appliedText: 'VP of Engineering',
    createdAt: '2026-10-30T14:05:00.000Z',
    revertedAt: null,
  },
  {
    id: 'h3',
    actor: 'import',
    section: 'experience',
    kind: 'value',
    itemId: 'exp-2',
    label: 'Director of Engineering · PayGrid',
    previousText: '',
    appliedText: 'Director of Engineering · PayGrid',
    createdAt: '2026-10-21T08:00:00.000Z',
    revertedAt: '2026-10-22T08:00:00.000Z',
  },
];

function snapshot() {
  return {
    candidate: {
      id: CANDIDATE.candidateId,
      dataClass: 'synthetic',
      locale: 'ru-RU',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    messages: [],
    memory: MEMORY,
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
    importedSources: [],
  };
}

async function stubApi(page: Page, history: readonly ProfileHistoryItem[]): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { data: CANDIDATE } });
    if (path === '/api/v1/candidate/me') return route.fulfill({ json: { data: snapshot() } });
    if (path === '/api/v1/candidate/me/messages') {
      return route.fulfill({ json: { data: [], meta: { nextOffset: null } } });
    }
    if (path === '/api/v1/account' || path === '/api/v1/account/profile') {
      return route.fulfill({ json: { data: ACCOUNT } });
    }
    if (path === '/api/v1/candidate/workspace') return route.fulfill({ json: { data: WORKSPACE } });
    if (path === '/api/v1/candidate/profile/history') {
      const data = { entries: history, total: history.length, page: 0, pageSize: 20 };
      return route.fulfill({ json: { data } });
    }
    if (path === '/api/v1/candidate/resume/versions') {
      const data = { items: [], nextCursor: null, totalCount: 0, currentMasterRevision: 'm' };
      return route.fulfill({ json: { data } });
    }
    if (path === '/api/v1/candidate/resume') {
      const data = {
        draft: DRAFT,
        savedAt: { createdAt: ACCEPTED_AT, updatedAt: ACCEPTED_AT },
        projection: previewProjection(DRAFT, MEMORY),
        evidenceFreshness: { stale: [] },
      };
      return route.fulfill({ json: { data } });
    }
    return route.fulfill({ json: { data: null } });
  });
}

const WORKSPACE = {
  version: 7,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  resumeText: 'VP of Engineering.',
  resumeSource: 'text',
  targetDirection: 'VP of Engineering',
  regions: ['de'],
  currentSituation: 'Ищу следующую роль.',
  constraints: '',
  urgency: 'active',
  outcomes: [],
};

async function openProfile(page: Page): Promise<void> {
  await page.addInitScript(
    ({ candidateId, workspace }) => {
      window.localStorage.setItem('candidate-workspace', JSON.stringify(workspace));
      window.localStorage.setItem('candidate-workspace-owner', candidateId);
    },
    { candidateId: CANDIDATE.candidateId, workspace: WORKSPACE },
  );
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await waitForCareerShell(page);
  await page.getByRole('button', { name: 'Профиль', exact: true }).click();
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('1440: accepted place reads «Подтверждено вами · с консультантом», history lists changes', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop-1440', 'desktop layout');
  await stubApi(page, HISTORY);
  await openProfile(page);

  const accepted = page.locator('[data-experience-id="exp-1"]');
  // One green check «Подтверждено»; the full sentence stays its accessible name (owner, 02.11).
  await expect(
    accepted.getByLabel('Подтверждено вами · с консультантом 01.11', { exact: false }),
  ).toHaveText('Подтверждено');
  const unconfirmed = page.locator('[data-experience-id="exp-2"]');
  await expect(unconfirmed.getByRole('button', { name: 'Подтвердить' })).toBeVisible();
  await accepted.scrollIntoViewIfNeeded();
  await accepted.screenshot({ path: join(EVIDENCE_DIR, 'badge-after-accept-1440.png') });

  const history = page.locator('#sec-history');
  await history.scrollIntoViewIfNeeded();
  // Folded by default (owner, 02.11): nothing is listed until the summary opens it.
  await expect(history.getByTestId('profile-history-row')).toHaveCount(0);
  await history.getByText('История изменений').click();
  await expect(history.getByTestId('profile-history-row')).toHaveCount(4);
  await expect(history.getByText('Консультант').first()).toBeVisible();
  await expect(history.getByRole('button', { name: 'Вернуть' })).toHaveCount(3);
  await expect(history.getByText('Навык ITIL — подтверждён проверкой')).toBeVisible();
  await expect(history.getByText('было: —')).toHaveCount(0);
  await expect(history.getByText(/null|\{/)).toHaveCount(0);
  await history.screenshot({ path: join(EVIDENCE_DIR, 'history-1440.png') });
});

test('390: «История изменений» opens from the profile home', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-390', 'phone layout');
  await stubApi(page, HISTORY);
  await openProfile(page);

  await page.getByRole('button', { name: /История изменений/ }).click();
  await expect(page.locator('.career-profile-mobile')).toHaveAttribute(
    'data-mobile-profile-page',
    'history',
  );
  await expect(page.getByTestId('profile-history-row')).toHaveCount(4);
  await noHorizontalScroll(page);
  const revert = page.getByRole('button', { name: 'Вернуть' }).first();
  expect((await revert.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'history-390.png'), fullPage: true });
});

test('390: empty history says what will appear there', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-390', 'phone layout');
  await stubApi(page, []);
  await openProfile(page);
  await page.getByRole('button', { name: /История изменений/ }).click();
  await expect(page.getByText(/Изменений пока нет/)).toBeVisible();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'history-empty-390.png') });
});
