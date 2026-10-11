import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import type {
  CareerDiaryAchievement,
  CareerDiaryAchievementInput,
  CareerDiaryOverview,
  CareerDiaryWeeklyReview,
  CareerDiaryWeeklyReviewInput,
} from '../shared/careerDiary';
import type { CareerCommand, CoachResult } from '../src/features/coach/coachApi';
import { candidateSnapshot } from './fixtures/readabilityWorkspace';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const DIARY_API = '/api/v1/candidate/career-diary';
const EVIDENCE = e2eEvidenceDirectory('B458');
const AS_OF = '2026-10-10';

type DiaryMode = 'empty' | 'partial' | 'many';

interface DiaryHarness {
  readonly mode: DiaryMode;
  reviews: CareerDiaryWeeklyReview[];
  achievements: CareerDiaryAchievement[];
  failReviewSave: boolean;
  failAchievementSave: boolean;
  deferReviews: boolean;
  readonly reviewGate: Promise<void>;
  releaseReviews: () => void;
  coachResult?: CoachResult;
  turnIdempotencyKey?: string;
  command?: CareerCommand;
  resumeDraft: typeof candidateSnapshot.resume.draft;
  readonly previousAbout: string;
}

function mondayAt(index: number): string {
  const date = new Date('2026-02-02T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + index * 7);
  return date.toISOString().slice(0, 10);
}

function reviewAt(index: number): CareerDiaryWeeklyReview {
  const weekStart = mondayAt(index);
  return {
    weekStart,
    movedForward: 'Согласовали цели команды, неделя ' + String(index + 1) + '.',
    blockers: 'Не хватало сводки по задачам.',
    learning: 'Проверять источник до встречи.',
    risks: 'Сроки двух задач требуют внимания.',
    nextWeek: 'Получить подтверждение от команды.',
    createdAt: weekStart + 'T12:00:00.000Z',
    updatedAt: weekStart + 'T12:00:00.000Z',
  };
}

function achievementAt(index: number): CareerDiaryAchievement {
  return {
    id: 'achievement-' + String(index + 1),
    situation: 'Не хватало данных по бюджету, запись ' + String(index + 1) + '.',
    action: 'Подготовил расчёт и согласовал его с финансовым директором.',
    result: 'Бюджет утверждён на три позиции.',
    status: 'ready_to_add',
    createdAt: '2026-10-08T09:00:00.000Z',
    updatedAt: '2026-10-08T09:00:00.000Z',
  };
}

function createHarness(mode: DiaryMode = 'partial'): DiaryHarness {
  let releaseReviews = () => undefined;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReviews = resolve;
  });
  const resumeDraft = structuredClone(candidateSnapshot.resume.draft);
  return {
    mode,
    reviews:
      mode === 'empty'
        ? []
        : mode === 'many'
          ? Array.from({ length: 24 }, (_, index) => reviewAt(index))
          : [reviewAt(0)],
    achievements:
      mode === 'empty'
        ? []
        : mode === 'many'
          ? Array.from({ length: 24 }, (_, index) => achievementAt(index))
          : [achievementAt(0)],
    failReviewSave: false,
    failAchievementSave: false,
    deferReviews: false,
    reviewGate,
    releaseReviews,
    resumeDraft,
    previousAbout: resumeDraft.candidate.about ?? '',
  };
}

function overviewFor(state: DiaryHarness): CareerDiaryOverview {
  return {
    asOf: AS_OF,
    primaryWorkplace: {
      id: 'workplace-1',
      company: 'Пример',
      title: 'Руководитель команды',
      startDate: '2026-09-07',
      endDate: null,
      sourceExperienceId: null,
      status: 'active',
      isPrimary: true,
      createdAt: '2026-09-07T09:00:00.000Z',
      updatedAt: '2026-09-07T09:00:00.000Z',
    },
    summary: {
      goalsAchieved: 0,
      goalsAtRisk: 0,
      goalsTotal: 0,
      achievementsReadyToAdd: state.achievements.filter((item) => item.status === 'ready_to_add')
        .length,
      weeklyReviewsTotal: state.reviews.length,
      weeklyReviewsInRow: state.reviews.length,
    },
  };
}

function pagedItems<T>(route: Route, items: readonly T[]) {
  const cursor = new URL(route.request().url()).searchParams.get('cursor');
  const offset = cursor ? 20 : 0;
  const page = items.slice(offset, offset + 20);
  return route.fulfill({
    json: {
      data: { items: page, nextCursor: offset + page.length < items.length ? 'page-2' : null },
    },
  });
}

async function handleDiaryRoute(route: Route, state: DiaryHarness): Promise<void> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  const parts = path.slice(DIARY_API.length).split('/').filter(Boolean);
  if (parts.length === 0 && method === 'GET') {
    return route.fulfill({ json: { data: overviewFor(state) } });
  }
  if (parts[0] === 'goals' && method === 'GET') {
    return parts.length === 1
      ? route.fulfill({ json: { data: { items: [], nextCursor: null } } })
      : route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  }
  if (parts[0] === 'reviews' && parts.length === 1 && method === 'GET') {
    if (state.deferReviews) await state.reviewGate;
    return pagedItems(route, state.reviews);
  }
  if (parts[0] === 'reviews' && parts.length === 2 && method === 'PUT') {
    if (state.failReviewSave) {
      return route.fulfill({
        status: 503,
        json: { error: { code: 'save_failed', message: 'Не удалось сохранить разбор.' } },
      });
    }
    const input = request.postDataJSON() as CareerDiaryWeeklyReviewInput;
    const now = '2026-10-10T12:00:00.000Z';
    const saved: CareerDiaryWeeklyReview = {
      ...input,
      createdAt: state.reviews.find((item) => item.weekStart === input.weekStart)?.createdAt ?? now,
      updatedAt: now,
    };
    state.reviews = [saved, ...state.reviews.filter((item) => item.weekStart !== input.weekStart)];
    return route.fulfill({ json: { data: saved } });
  }
  if (parts[0] === 'achievements' && parts.length === 1 && method === 'GET') {
    return pagedItems(route, state.achievements);
  }
  if (parts[0] === 'achievements' && parts.length === 1 && method === 'POST') {
    if (state.failAchievementSave) {
      return route.fulfill({
        status: 503,
        json: { error: { code: 'save_failed', message: 'Не удалось сохранить достижение.' } },
      });
    }
    const input = request.postDataJSON() as CareerDiaryAchievementInput;
    const created: CareerDiaryAchievement = {
      ...input,
      id: 'achievement-created',
      status: 'ready_to_add',
      createdAt: '2026-10-10T12:00:00.000Z',
      updatedAt: '2026-10-10T12:00:00.000Z',
    };
    state.achievements = [created, ...state.achievements];
    return route.fulfill({ status: 201, json: { data: created } });
  }
  if (parts[0] === 'achievements' && parts.length === 2 && method === 'GET') {
    const found = state.achievements.find((item) => item.id === parts[1]);
    return route.fulfill(
      found ? { json: { data: found } } : { status: 404, json: { error: { code: 'not_found' } } },
    );
  }
  if (parts[0] === 'achievements' && parts.length === 2 && method === 'PATCH') {
    const found = state.achievements.find((item) => item.id === parts[1]);
    if (!found) return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
    const body = request.postDataJSON() as { status: 'ready_to_add' | 'dismissed' };
    const updated = { ...found, status: body.status, updatedAt: '2026-10-10T12:00:00.000Z' };
    state.achievements = state.achievements.map((item) =>
      item.id === updated.id ? updated : item,
    );
    return route.fulfill({ json: { data: updated } });
  }
  if (
    parts[0] === 'goals' &&
    parts.length === 3 &&
    parts[2] === 'measurements' &&
    method === 'GET'
  ) {
    return route.fulfill({ json: { data: { items: [], nextCursor: null } } });
  }
  if (parts[0] === 'workplaces' && method === 'GET') {
    return route.fulfill({ json: { data: { items: [], nextCursor: null } } });
  }
  return route.fallback();
}

async function handleCoachRoute(route: Route, state: DiaryHarness): Promise<void> {
  const body = route.request().postDataJSON() as { messageId: string };
  const achievement = state.achievements[0];
  const proposal: CoachResult['actionProposals'][number] = {
    kind: 'resume.revise',
    objective: 'Добавить достижение из дневника в профиль.',
    evidenceRefs: [body.messageId],
    acceptanceCriteria: ['Сохранить подтверждённый результат.'],
    expectedSignal: 'Результат виден в профиле с источником из дневника.',
    measureAfter: '2026-12-31',
    risk: 'candidate_data_write',
    resumeRevision: {
      section: 'about',
      experienceId: null,
      memoryId: null,
      proposedText:
        state.previousAbout + ' ' + achievement?.result + ' Источник: карьерный дневник.',
    },
  };
  state.turnIdempotencyKey = route.request().headers()['idempotency-key'] ?? 'turn-diary-1';
  state.coachResult = {
    message: 'Предлагаю добавить подтверждённый результат в раздел профиля.',
    phase: 'resume',
    nextQuestion: null,
    completeness: { known: [], unknown: [] },
    safety: { needsHuman: false, reason: null },
    careerTrack: null,
    actionProposals: [proposal],
  };
  await route.fulfill({ json: { data: state.coachResult } });
}

function commandFor(state: DiaryHarness, proposalIndex: number): CareerCommand | null {
  const proposal = state.coachResult?.actionProposals[proposalIndex];
  const revision = proposal?.resumeRevision;
  if (!proposal || !revision || !state.turnIdempotencyKey) return null;
  const currentText = state.resumeDraft.candidate.about ?? '';
  return {
    commandId: 'command-diary-1',
    capability: proposal.kind,
    status: 'awaiting_approval',
    proposal,
    provenance: {
      strategyDecisionId: state.turnIdempotencyKey,
      evidenceRefs: [...proposal.evidenceRefs],
      modelInvocationIds: ['model-diary-1'],
    },
    executionTarget: {
      section: revision.section,
      experienceId: revision.experienceId ?? undefined,
      memoryId: revision.memoryId ?? undefined,
      currentText,
      previousText: currentText,
      proposedText: revision.proposedText,
    },
    execution: null,
  };
}

async function handleCareerCommandRoute(route: Route, state: DiaryHarness): Promise<void> {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const base = '/api/v1/candidate/career-commands';
  const suffix = path.slice(base.length).split('/').filter(Boolean);
  const method = request.method();
  if (suffix.length === 0 && method === 'GET') {
    return route.fulfill({ json: { data: state.command ? [state.command] : [] } });
  }
  if (suffix.length === 0 && method === 'POST') {
    const body = request.postDataJSON() as { proposalIndex: number };
    const command = commandFor(state, body.proposalIndex);
    if (!command)
      return route.fulfill({ status: 404, json: { error: { code: 'proposal_not_found' } } });
    state.command = command;
    return route.fulfill({ status: 201, json: { data: command } });
  }
  if (suffix.length === 1 && method === 'GET' && state.command) {
    return route.fulfill({ json: { data: state.command } });
  }
  if (suffix.length === 2 && suffix[1] === 'approvals' && method === 'POST' && state.command) {
    state.resumeDraft = {
      ...state.resumeDraft,
      candidate: {
        ...state.resumeDraft.candidate,
        about: state.command.executionTarget?.proposedText,
      },
    };
    state.command = {
      ...state.command,
      status: 'completed_with_receipt',
      execution: {
        status: 'completed_with_receipt',
        updatedAt: '2026-10-10T12:00:00.000Z',
        connector: {
          id: 'candidate-profile',
          transport: 'internal',
          providerReference: null,
          evidenceKind: 'candidate_confirmation',
          evidenceObservedAt: '2026-10-10T12:00:00.000Z',
        },
        diagnosticReason: null,
      },
    };
    return route.fulfill({ json: { data: state.command } });
  }
  if (suffix.length === 2 && suffix[1] === 'revert' && method === 'POST' && state.command) {
    state.resumeDraft = {
      ...state.resumeDraft,
      candidate: {
        ...state.resumeDraft.candidate,
        about: state.command.executionTarget?.previousText,
      },
    };
    state.command = { ...state.command, profileRevisionReverted: true };
    return route.fulfill({ json: { data: state.command } });
  }
  return route.fallback();
}

function resumeView(state: DiaryHarness) {
  const document = {
    kind: 'master',
    targetRole: state.resumeDraft.targetRole ?? null,
    contact: {
      fullName: state.resumeDraft.candidate.fullName ?? null,
      email: null,
      phone: null,
      location: state.resumeDraft.candidate.contact?.location ?? null,
      links: [...(state.resumeDraft.candidate.contact?.links ?? [])],
    },
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
  return {
    data: {
      draft: state.resumeDraft,
      savedAt: { createdAt: candidateSnapshot.resume.createdAt, updatedAt: state.resumeUpdatedAt },
      projection: {
        master: document,
        germanyVariant: { ...document, kind: 'country-role' },
        evidenceSnapshot: [],
        excludedEvidenceIds: [],
      },
      evidenceFreshness: { valid: true, stale: [] },
    },
  };
}

async function installMocks(page: Page, state: DiaryHarness): Promise<void> {
  await mockSignedInCabinet(page);
  await page.route('**/api/v1/candidate/career-diary**', (route) => handleDiaryRoute(route, state));
  await page.route('**/api/v1/coach/turn*', (route) => handleCoachRoute(route, state));
  await page.route('**/api/v1/candidate/career-commands**', (route) =>
    handleCareerCommandRoute(route, state),
  );
  await page.route('**/api/v1/candidate/resume', async (route) => {
    if (route.request().method() === 'PUT') {
      state.resumeDraft = route.request().postDataJSON() as ResumeDraft;
    }
    await route.fulfill({ json: resumeView(state) });
  });
}

async function navigateDiary(page: Page, projectName: string): Promise<void> {
  if (projectName === 'mobile-390') {
    const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
    await navigation.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Карьерный дневник' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьерный дневник' })
      .click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Карьерный дневник' })).toBeVisible();
}

async function openDiary(page: Page, testInfo: TestInfo, state: DiaryHarness): Promise<void> {
  await installMocks(page, state);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await navigateDiary(page, testInfo.project.name);
}

async function captureDiary(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: join(EVIDENCE, state + '-' + testInfo.project.name + '.png'),
    fullPage: true,
  });
}

async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function fillReview(page: Page): Promise<void> {
  await page.getByLabel('Что сдвинулось').fill('Согласовал бюджет на три позиции.');
  await page.getByLabel('Что мешало').fill('Не хватало общей сводки.');
  await page.getByLabel('Чему научился').fill('Проверять данные до планирования.');
  await page.getByLabel('Риски и блокеры').fill('Сроки двух задач требуют внимания.');
  await page.getByLabel('Вывод на следующую неделю').fill('Сверить приоритеты с командой.');
}

async function fillAchievement(page: Page): Promise<void> {
  await page.getByLabel('Ситуация', { exact: true }).fill('Не хватало данных по бюджету.');
  await page
    .getByLabel('Действие', { exact: true })
    .fill('Подготовил расчёт и согласовал его с финансовым директором.');
  await page.getByLabel('Результат', { exact: true }).fill('Бюджет утверждён на три позиции.');
}

test('saves a weekly review and lists it separately from past weeks', async ({
  page,
}, testInfo) => {
  const state = createHarness('partial');
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Разборы/u }).click();
  await expect(page.getByRole('button', { name: /Заполнить разбор недели/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Прошлые недели' })).toBeVisible();
  await captureDiary(page, testInfo, 'review-partial');

  await page.getByRole('button', { name: /Заполнить разбор недели/u }).click();
  await fillReview(page);
  await expectNoOverflow(page);
  await captureDiary(page, testInfo, 'review-form');
  await page.getByRole('button', { name: 'Сохранить разбор' }).click();

  await expect(page.getByRole('status')).toContainText('Разбор сохранён');
  expect(state.reviews.some((item) => item.weekStart === '2026-10-05')).toBe(true);
  await captureDiary(page, testInfo, 'review-saved');
});

test('keeps the weekly review editable after a failed save', async ({ page }, testInfo) => {
  const state = createHarness('empty');
  state.failReviewSave = true;
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Разборы/u }).click();
  await page.getByRole('button', { name: /Заполнить разбор недели/u }).click();
  await fillReview(page);
  await page.getByRole('button', { name: 'Сохранить разбор' }).click();

  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить разбор');
  await expect(page.getByLabel('Что сдвинулось')).toHaveValue('Согласовал бюджет на три позиции.');
  await captureDiary(page, testInfo, 'review-save-error');
});

test('shows loading and empty weekly and achievement records', async ({ page }, testInfo) => {
  const state = createHarness('empty');
  state.deferReviews = true;
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Разборы/u }).click();
  await expect(page.getByRole('status')).toContainText('Загружаем записи');
  await captureDiary(page, testInfo, 'review-loading');
  state.releaseReviews();
  state.deferReviews = false;
  await expect(page.getByRole('heading', { name: 'Прошлые недели пока нет' })).toBeVisible();
  await captureDiary(page, testInfo, 'review-empty');

  await page.getByRole('tab', { name: /Результаты|Достижения в профиль/u }).click();
  await expect(
    page.getByRole('heading', { name: 'Достижения для профиля пока нет' }),
  ).toBeVisible();
  await captureDiary(page, testInfo, 'achievement-empty');
});

test('loads the next page of many weekly reviews', async ({ page }, testInfo) => {
  const state = createHarness('many');
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Разборы/u }).click();
  await expect(page.locator('.career-diary-records__list .career-diary-record')).toHaveCount(20);
  await captureDiary(page, testInfo, 'reviews-many');
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.locator('.career-diary-records__list .career-diary-record')).toHaveCount(24);
});

test('adds a missing achievement with situation, action and result', async ({ page }, testInfo) => {
  const state = createHarness('empty');
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Результаты|Достижения в профиль/u }).click();
  await page.getByRole('button', { name: 'Добавить недостающее достижение' }).click();
  await fillAchievement(page);
  await expectNoOverflow(page);
  await captureDiary(page, testInfo, 'achievement-form');
  await page.getByRole('button', { name: 'Сохранить достижение' }).click();
  await expect(
    page.getByRole('heading', { name: 'Бюджет утверждён на три позиции.' }),
  ).toBeVisible();
  expect(state.achievements).toHaveLength(1);
  await captureDiary(page, testInfo, 'achievement-created');
});

test('routes a diary achievement through profile approval and rollback', async ({
  page,
}, testInfo) => {
  const state = createHarness('partial');
  await openDiary(page, testInfo, state);
  await page.getByRole('tab', { name: /Результаты|Достижения в профиль/u }).click();
  await page.getByRole('button', { name: 'Добавить в профиль' }).click();
  await captureDiary(page, testInfo, 'achievement-proposal-start');
  await page.getByRole('button', { name: 'Спросить консультанта' }).click();

  const proposal = page.locator('.career-action-proposal');
  await expect(proposal).toContainText('Добавить достижение из дневника в профиль');
  expect(state.coachResult?.actionProposals[0]?.evidenceRefs[0]).toMatch(/^diary:achievement-1:/u);
  await captureDiary(page, testInfo, 'achievement-proposal');
  const prepareButton = page.getByRole('button', {
    name: 'Подготовить правку для Профиля',
  });
  await prepareButton.scrollIntoViewIfNeeded();
  await expect(prepareButton).toBeInViewport();
  await captureDiary(page, testInfo, 'achievement-proposal-action');
  await prepareButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Правка подготовлена.' })).toContainText(
    'Откройте «Профиль»',
  );
  await expectNoOverflow(page);

  if (testInfo.project.name === 'mobile-390') {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: 'Профиль' })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Профиль' })
      .click();
  }
  const suggestion = page.getByRole('region', { name: 'Предложение карьерного консультанта' });
  await expect(suggestion).toContainText('Предложение из карьерного дневника');
  await suggestion.getByRole('button', { name: 'Принять' }).click();
  await expect(suggestion).toContainText('Правка применена');
  await expect(suggestion).toContainText('Источник: карьерный дневник');
  await captureDiary(page, testInfo, 'achievement-profile-applied');

  await suggestion.getByRole('button', { name: 'Откатить' }).click();
  await expect(suggestion).toHaveCount(0);
  await captureDiary(page, testInfo, 'achievement-profile-reverted');
});
