import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const LINE = 'Сократил срок релиза с 14 до 7 дней за квартал';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-transfer-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const principal: AuthPrincipal = {
    userId: 'user-flagged',
    username: 'flagged.test',
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate,
  };
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => (token === flagged ? principal : null),
  };
  candidateStore.saveResumeDraft(
    candidate.id,
    {
      ...EMPTY_RESUME_DRAFT,
      experience: [
        {
          id: 'e1',
          chronologyMemoryId: 'c1',
          employer: 'Вектор Банк',
          title: 'Руководитель разработки',
          current: true,
          bulletMemoryIds: [],
        },
      ],
    } as never,
    [],
  );
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return { app, candidateStore, candidateId: candidate.id };
}

function call(app: App, method: 'GET' | 'POST', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${flagged}`,
      origin: ORIGIN,
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** Цель с одним показателем; `reach` — замер, который её достигает. */
async function goal(app: App, reach: boolean) {
  const created = await call(app, 'POST', `${DIARY}/goal-cards`, {
    title: 'Выпускать релиз за неделю',
    horizon: 'quarter',
    startDate: '2026-10-01',
    dueDate: '2099-01-29',
    setBy: 'manager',
    indicators: [{ title: 'Срок релиза, дней', unit: 'дней', baselineValue: 14, targetValue: 7 }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const card = created.json().data as { id: string; indicators: Array<{ id: string }> };
  if (reach) {
    const measured = await call(
      app,
      'POST',
      `${DIARY}/goals/${card.indicators[0]!.id}/measurements`,
      {
        value: 7,
        measuredAt: '2026-11-20',
      },
    );
    expect(measured.statusCode, measured.body).toBe(201);
  }
  return card.id;
}

const bullets = (store: SqliteCandidateStore, id: string) =>
  store.getSnapshot(id).resume?.draft?.experience[0]?.bulletMemoryIds ?? [];

describe('B742: «Перенести» достигнутую цель в профиль', () => {
  it('строка результата под местом работы, перенос записан в цели', async () => {
    const { app, candidateStore, candidateId } = await setup();
    const id = await goal(app, true);
    const before = await call(app, 'GET', `${DIARY}/goal-cards`);
    expect(before.json().data.items[0].details.transfer).toBeNull();

    const moved = await call(app, 'POST', `${DIARY}/goal-cards/${id}/transfer`, {
      experienceId: 'e1',
      line: `  ${LINE}  `,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const transfer = moved.json().data.details.transfer;
    expect(transfer).toMatchObject({ experienceId: 'e1' });
    expect(bullets(candidateStore, candidateId)).toEqual([transfer.memoryId]);
    const fact = candidateStore
      .getSnapshot(candidateId)
      .memory.find((item) => item.id === transfer.memoryId);
    expect(fact?.statement).toBe(LINE);
  });

  it('повтор не добавляет вторую строку', async () => {
    const { app, candidateStore, candidateId } = await setup();
    const id = await goal(app, true);
    const first = await call(app, 'POST', `${DIARY}/goal-cards/${id}/transfer`, {
      experienceId: 'e1',
      line: LINE,
    });
    const again = await call(app, 'POST', `${DIARY}/goal-cards/${id}/transfer`, {
      experienceId: 'e1',
      line: 'Другая строка',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.details.transfer).toEqual(first.json().data.details.transfer);
    expect(bullets(candidateStore, candidateId)).toHaveLength(1);
  });

  it('недостигнутая цель, чужая позиция, пустая строка и нет цели — отказ без записи', async () => {
    const { app, candidateStore, candidateId } = await setup();
    const open = await goal(app, false);
    const notYet = await call(app, 'POST', `${DIARY}/goal-cards/${open}/transfer`, {
      experienceId: 'e1',
      line: LINE,
    });
    expect(notYet.statusCode).toBe(409);
    expect(notYet.json().error.code).toBe('career_diary_goal_not_achieved');

    const done = await goal(app, true);
    const unknown = await call(app, 'POST', `${DIARY}/goal-cards/${done}/transfer`, {
      experienceId: 'e9',
      line: LINE,
    });
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json().error.code).toBe('career_diary_experience_missing');

    const empty = await call(app, 'POST', `${DIARY}/goal-cards/${done}/transfer`, {
      experienceId: 'e1',
      line: '   ',
    });
    expect(empty.statusCode).toBe(400);
    const missing = await call(app, 'POST', `${DIARY}/goal-cards/${randomUUID()}/transfer`, {
      experienceId: 'e1',
      line: LINE,
    });
    expect(missing.statusCode).toBe(404);
    expect(bullets(candidateStore, candidateId)).toEqual([]);
    const cards = (await call(app, 'GET', `${DIARY}/goal-cards`)).json().data.items;
    expect(cards.map((card: { details: { transfer: unknown } }) => card.details.transfer)).toEqual([
      null,
      null,
    ]);
  });
});
