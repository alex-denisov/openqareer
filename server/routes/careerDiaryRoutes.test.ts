import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { describe, expect, it } from 'vitest';
import type { RouteDeps } from './deps';
import { registerCareerDiaryRoutes } from './careerDiaryRoutes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

const goalInput = {
  title: 'Снизить число инцидентов P1',
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
};

async function createApi() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 23),
  });
  const first = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const second = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = Fastify();
  await app.register(cookie);
  const deps = {
    config: { secureCookies: false },
    authService: { authenticate: () => null },
    candidateStore,
  } as unknown as RouteDeps;
  registerCareerDiaryRoutes(app, deps);
  return { app, candidateStore, first, second };
}

function auth(candidate: { readonly accessToken: string }) {
  return { authorization: 'Bearer ' + candidate.accessToken, 'idempotency-key': randomUUID() };
}

describe('career diary API (B456)', () => {
  it('creates goals, records measurements, returns risk reasons and splits goals', async () => {
    const { app, candidateStore, first } = await createApi();
    try {
      const createHeaders = auth(first);
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        headers: createHeaders,
        payload: goalInput,
      });
      expect(created.statusCode).toBe(201);
      expect(created.headers.location).toBe('/api/v1/candidate/career-diary/goals/' + createHeaders['idempotency-key']);
      const goalId = created.json().data.id as string;
      const replay = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        headers: createHeaders,
        payload: goalInput,
      });
      expect(replay.json().data.id).toBe(goalId);
      const conflictingReplay = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        headers: createHeaders,
        payload: { ...goalInput, title: 'Другая цель' },
      });
      expect(conflictingReplay.statusCode).toBe(409);
      const measured = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements',
        headers: auth(first),
        payload: { value: 8, measuredAt: new Date().toISOString().slice(0, 10) },
      });
      expect(measured.statusCode).toBe(201);
      const measurementId = measured.json().data.id as string;
      expect(measured.headers.location).toBe(
        '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements/' + measurementId,
      );
      const fetchedMeasurement = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements/' + measurementId,
        headers: auth(first),
      });
      expect(fetchedMeasurement.json().data.value).toBe(8);
      const overview = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary',
        headers: auth(first),
      });
      const goals = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals?limit=10',
        headers: auth(first),
      });
      expect(goals.json().data.items[0].risk).toMatchObject({
        status: 'at_risk',
        rule: 'linear_progress_v1',
        actualValue: 8,
      });
      expect(goals.json().data.nextCursor).toBeNull();
      expect(overview.json().data.summary.goalsAtRisk).toBe(1);
      const split = await app.inject({
        method: 'PUT',
        url: '/api/v1/candidate/career-diary/goals/' + goalId + '/children',
        headers: auth(first),
        payload: { children: [goalInput, { ...goalInput, title: 'Проверить причины инцидентов' }] },
      });
      expect(split.statusCode).toBe(200);
      expect(split.json().data).toHaveLength(2);
      expect(split.json().data[0].parentGoalId).toBe(goalId);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('prepares achievements and keeps the overview candidate-scoped', async () => {
    const { app, candidateStore, first, second } = await createApi();
    try {
      const achievement = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/achievements',
        headers: auth(first),
        payload: {
          situation: 'Срывались релизы.',
          action: 'Согласовал план.',
          result: 'Срок сократился.',
        },
      });
      const otherCandidateDiary = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary',
        headers: auth(second),
      });

      expect(achievement.statusCode).toBe(201);
      expect(achievement.json().data.status).toBe('ready_to_add');
      expect(otherCandidateDiary.json().data).toMatchObject({
        primaryWorkplace: null,
        summary: {
          goalsAchieved: 0,
          goalsAtRisk: 0,
          goalsTotal: 0,
          achievementsReadyToAdd: 0,
          weeklyReviewsTotal: 0,
          weeklyReviewsInRow: 0,
        },
      });
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('updates and deletes a candidate goal together with its measurement history', async () => {
    const { app, candidateStore, first } = await createApi();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        headers: auth(first),
        payload: goalInput,
      });
      const goalId = created.json().data.id as string;
      await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements',
        headers: auth(first),
        payload: { value: 8, measuredAt: new Date().toISOString().slice(0, 10) },
      });
      const updated = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/goals/' + goalId,
        headers: auth(first),
        payload: { title: 'Сократить инциденты P1' },
      });
      const history = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements',
        headers: auth(first),
      });

      expect(history.statusCode, JSON.stringify(history.json())).toBe(200);
      expect(updated.json().data.title).toBe('Сократить инциденты P1');
      expect(history.json().data.items).toHaveLength(1);
      expect(history.json().data.items[0].source).toBe('candidate_entered');
      const invalidDates = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/goals/' + goalId,
        headers: auth(first),
        payload: { dueDate: '2025-12-31' },
      });
      expect(invalidDates.statusCode).toBe(400);
      const deleted = await app.inject({
        method: 'DELETE',
        url: '/api/v1/candidate/career-diary/goals/' + goalId,
        headers: auth(first),
      });
      expect(deleted.json().data.deleted).toBe(true);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/candidate/career-diary/goals/' + goalId,
            headers: auth(first),
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('upserts and deletes a weekly review by candidate and week', async () => {
    const { app, candidateStore, first } = await createApi();
    const weekStart = '2026-12-07';
    const review = {
      movedForward: 'Согласован бюджет.',
      blockers: 'Нет данных от подрядчика.',
      learning: 'Уточнять владельцев заранее.',
      risks: 'Срок согласования.',
      nextWeek: 'Запустить пилот.',
    };
    const url = '/api/v1/candidate/career-diary/reviews/' + weekStart;
    try {
      await app.inject({ method: 'PUT', url, headers: auth(first), payload: review });
      const updated = await app.inject({
        method: 'PUT',
        url,
        headers: auth(first),
        payload: { ...review, movedForward: 'Пилот запущен.' },
      });
      const reviews = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/reviews?limit=10',
        headers: auth(first),
      });
      const stored = await app.inject({ method: 'GET', url, headers: auth(first) });
      expect(updated.json().data.movedForward).toBe('Пилот запущен.');
      expect(reviews.json().data.items).toHaveLength(1);
      expect(stored.json().data.movedForward).toBe('Пилот запущен.');
      const deleted = await app.inject({ method: 'DELETE', url, headers: auth(first) });
      expect(deleted.json().data.deleted).toBe(true);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('changes achievement status and primary workplace through candidate-scoped routes', async () => {
    const { app, candidateStore, first } = await createApi();
    try {
      const achievement = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/achievements',
        headers: auth(first),
        payload: {
          situation: 'Срывались релизы.',
          action: 'Согласовал план.',
          result: 'Срок сократился.',
        },
      });
      const achievementId = achievement.json().data.id as string;
      const dismissed = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/achievements/' + achievementId,
        headers: auth(first),
        payload: { status: 'dismissed' },
      });
      expect(dismissed.json().data.status).toBe('dismissed');

      const firstPlace = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/workplaces',
        headers: auth(first),
        payload: { company: 'Норма Групп', title: 'Head of Engineering', startDate: '2020-01-01' },
      });
      const secondPlace = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/workplaces',
        headers: auth(first),
        payload: { company: 'Финтех Лаб', title: 'VP Engineering', startDate: '2024-01-01' },
      });
      const secondId = secondPlace.json().data.id as string;
      const primary = await app.inject({
        method: 'PUT',
        url: '/api/v1/candidate/career-diary/workplaces/' + secondId + '/primary',
        headers: auth(first),
      });

      expect(firstPlace.json().data.isPrimary).toBe(true);
      expect(primary.json().data.isPrimary).toBe(true);
      const archived = await app.inject({
        method: 'PUT',
        url: '/api/v1/candidate/career-diary/workplaces/' + secondId + '/archive',
        headers: auth(first),
        payload: { endDate: '2026-12-31' },
      });
      expect(archived.json().data).toMatchObject({ status: 'archived', isPrimary: false });
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/candidate/career-diary/workplaces',
            headers: auth(first),
          })
        )
          .json()
          .data.items.filter((place: { isPrimary: boolean }) => place.isPrimary),
      ).toHaveLength(0);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('round-trips adaptation planning in the candidate-scoped workplace payload', async () => {
    const { app, candidateStore, first, second } = await createApi();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/workplaces',
        headers: auth(first),
        payload: { company: 'Норма Групп', title: 'Head of Engineering', startDate: '2026-11-06' },
      });
      const workplaceId = created.json().data.id as string;
      const planning = {
        adaptationPlan: {
          id: 'plan-1',
          workplaceId,
          startDate: '2026-11-06',
          createdAt: '2026-10-20T12:00:00.000Z',
          status: 'active',
          closedAt: null,
          tasks: [{
            id: 'task-1',
            title: 'Сверить ожидания',
            description: 'Уточнить приоритеты первых недель.',
            stage: 'prep',
            category: 'alignment',
            dueDate: '2026-11-06',
            completed: false,
            source: 'template',
          }],
        },
      };
      const saved = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/workplaces/' + workplaceId,
        headers: auth(first),
        payload: { planning },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data.planning).toEqual(planning);
      const reread = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/workplaces/' + workplaceId,
        headers: auth(first),
      });
      expect(reread.json().data.planning).toEqual(planning);

      const otherCandidate = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/workplaces/' + workplaceId,
        headers: auth(second),
      });
      expect(otherCandidate.statusCode).toBe(404);

      await app.inject({
        method: 'PUT',
        url: '/api/v1/candidate/career-diary/workplaces/' + workplaceId + '/archive',
        headers: auth(first),
        payload: { endDate: '2026-12-31' },
      });
      const rejected = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/workplaces/' + workplaceId,
        headers: auth(first),
        payload: { planning },
      });
      expect(rejected.statusCode).toBe(409);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('persists a quarter decision together with the goal horizon change', async () => {
    const { app, candidateStore, first } = await createApi();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        headers: auth(first),
        payload: goalInput,
      });
      const goalId = created.json().data.id as string;
      const updated = await app.inject({
        method: 'PATCH',
        url: '/api/v1/candidate/career-diary/goals/' + goalId,
        headers: auth(first),
        payload: {
          horizon: 'next_quarter',
          dueDate: '2027-03-31',
          quarterDecision: { quarterId: 'Q4 2026', decision: 'move', decidedAt: '2026-12-06' },
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().data).toMatchObject({
        horizon: 'next_quarter',
        dueDate: '2027-03-31',
        quarterDecision: { quarterId: 'Q4 2026', decision: 'move' },
      });
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('uses stable cursor pages and rejects malformed cursors', async () => {
    const { app, candidateStore, first } = await createApi();
    try {
      for (const title of ['Согласовать бюджет', 'Сократить время сборки']) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/candidate/career-diary/goals',
          headers: auth(first),
          payload: { ...goalInput, title },
        });
      }
      const firstPage = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals?limit=1',
        headers: auth(first),
      });
      const firstItem = firstPage.json().data.items[0];
      const cursor = firstPage.json().data.nextCursor as string;
      const secondPage = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals?limit=1&cursor=' + encodeURIComponent(cursor),
        headers: auth(first),
      });
      const malformed = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate/career-diary/goals?cursor=not-a-valid-cursor',
        headers: auth(first),
      });

      expect(firstPage.statusCode).toBe(200);
      expect(typeof cursor).toBe('string');
      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.json().data.items).toHaveLength(1);
      expect(secondPage.json().data.items[0].id).not.toBe(firstItem.id);
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json().error).toHaveProperty('requestId');
    } finally {
      await app.close();
      candidateStore.close();
    }
  });

  it('requires a candidate session for reads and a same-origin or bearer for writes', async () => {
    const { app, candidateStore } = await createApi();
    try {
      const read = await app.inject({ method: 'GET', url: '/api/v1/candidate/career-diary' });
      const write = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate/career-diary/goals',
        payload: goalInput,
      });

      expect(read.statusCode).toBe(401);
      expect(write.statusCode).toBe(403);
    } finally {
      await app.close();
      candidateStore.close();
    }
  });
});
