import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { KpiModelAnswer } from '../domain/kpiImport';
import type { KpiExtractor } from '../providers/kpiExtractor';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const DIARY = '/api/v1/candidate/career-diary';
const KPI = `${DIARY}/kpi-imports`;
const flagged = 'token-flagged';
const other = 'token-other';
const plain = 'token-plain';
/** Тесты с несколькими сборками приложения или многими запросами идут дольше общего предела. */
const SLOW = 60_000;
const SOME_ID = '00000000-0000-4000-8000-000000000001';

const TEXT =
  'Релиз — не дольше 7 дней к концу января, вес 50 %. 2 вакансии закрыть до 28.02, вес 50 %. Поставил директор.';
const modelRow = (title: string, quote: string, targetValue: number, weight: number) => ({
  title,
  target: String(targetValue),
  targetValue,
  unit: '',
  dueDate: '2027-01-31',
  horizon: 'quarter' as const,
  weight,
  setBy: 'manager' as const,
  quote,
  quarterTargets: null,
});
const ANSWER: KpiModelAnswer = {
  sourceText: '',
  rows: [
    modelRow('Срок релиза', 'Релиз — не дольше 7 дней к концу января, вес 50 %', 7, 50),
    modelRow('Закрыто вакансий', '2 вакансии закрыть до 28.02, вес 50 %', 2, 50),
    modelRow('NPS', 'NPS не ниже 60', 60, 0),
  ],
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(extractor?: KpiExtractor) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-diary-kpi-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test', 'other.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([
    [flagged, principal('flagged.test')],
    [other, principal('other.test')],
    [plain, principal('plain.test')],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
    ...(extractor ? { kpiExtractor: extractor } : {}),
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return {
    app,
    databasePath: config.databasePath,
    store: candidateStore,
    candidate: sessions.get(flagged)!.candidate!.id,
  };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      origin: ORIGIN,
      'idempotency-key': randomUUID(),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const extractorOf = (answer: KpiModelAnswer | null) => ({ extract: vi.fn(async () => answer) });

const ACCEPT_ROW = {
  title: 'Срок релиза',
  unit: 'дней',
  targetValue: 7,
  dueDate: '2027-01-31',
  horizon: 'quarter',
  weight: 50,
  setBy: 'manager',
};

describe('B686: без флага B640', () => {
  it(
    'адреса отвечают как несуществующие, модель не зовётся, таблица не создаётся',
    async () => {
      const extractor = extractorOf(ANSWER);
      const { app, databasePath } = await setup(extractor);
      const absent = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
      const routes: Array<['GET' | 'POST' | 'DELETE', string, unknown?]> = [
        ['POST', KPI, { kind: 'text', text: TEXT }],
        ['GET', `${KPI}/${SOME_ID}`],
        ['POST', `${KPI}/${SOME_ID}/accept`, { rows: [ACCEPT_ROW] }],
        ['DELETE', `${KPI}/${SOME_ID}/source`],
      ];
      for (const [method, url, payload] of routes) {
        for (const token of [plain, undefined]) {
          const response = await call(app, method, url, token, payload);
          expect(response.statusCode, `${method} ${url}`).toBe(404);
          expect(response.json().error.code).toBe(absent.json().error.code);
        }
      }
      expect(extractor.extract).not.toHaveBeenCalled();
      const database = new DatabaseSync(databasePath, { readOnly: true });
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE name = 'career_diary_kpi_imports'")
        .all();
      database.close();
      expect(tables).toEqual([]);
    },
    SLOW,
  );
});

describe('B686: загрузка KPI под флагом', () => {
  it('текст → черновик только из того, что в тексте; исходник запечатан', async () => {
    const extractor = extractorOf(ANSWER);
    const { app, databasePath } = await setup(extractor);
    const created = await call(app, 'POST', KPI, flagged, { kind: 'text', text: TEXT });
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json().data;
    expect(draft.rows.map((row: { title: string }) => row.title)).toEqual([
      'Срок релиза',
      'Закрыто вакансий',
    ]);
    expect(draft).toMatchObject({
      sourceKind: 'text',
      weightSum: 100,
      sourceStored: true,
      acceptedGoalIds: [],
    });
    expect(extractor.extract).toHaveBeenCalledWith(expect.objectContaining({ text: TEXT }));

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const raw = JSON.stringify(database.prepare('SELECT * FROM career_diary_kpi_imports').all());
    database.close();
    expect(raw).not.toContain('вакансии');
    expect(raw).not.toContain('Срок релиза');

    const read = await call(app, 'GET', `${KPI}/${draft.id}`, flagged);
    expect(read.json().data.rows).toHaveLength(2);
    expect((await call(app, 'GET', `${KPI}/${draft.id}`, other)).statusCode).toBe(404);
  });

  it('таблица CSV идёт в модель текстом; файл не того вида — отказ без вызова модели', async () => {
    const extractor = extractorOf(ANSWER);
    const { app } = await setup(extractor);
    const csv = Buffer.from('Показатель,Цель\nСрок релиза,7\n').toString('base64');
    const table = await call(app, 'POST', KPI, flagged, {
      kind: 'table',
      name: 'kpi.csv',
      mimeType: 'text/csv',
      data: csv,
    });
    expect(table.statusCode).toBe(422);
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Показатель | Цель\nСрок релиза | 7' }),
    );

    extractor.extract.mockClear();
    const fake = Buffer.from('not an image').toString('base64');
    const photo = await call(app, 'POST', KPI, flagged, {
      kind: 'photo',
      name: 's.png',
      mimeType: 'image/png',
      data: fake,
    });
    expect(photo.statusCode).toBe(422);
    expect(photo.json().error.code).toBe('kpi_source_unreadable');
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('фото: модель получает картинку, цитаты сверяются с её текстом', async () => {
    const extractor = extractorOf({ ...ANSWER, sourceText: TEXT });
    const { app } = await setup(extractor);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      Buffer.alloc(32),
    ]);
    const created = await call(app, 'POST', KPI, flagged, {
      kind: 'photo',
      name: 'slide.png',
      mimeType: 'image/png',
      data: png.toString('base64'),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data.rows).toHaveLength(2);
    const [input] = extractor.extract.mock.calls[0] as unknown as [
      { image?: { mimeType: string } },
    ];
    expect(input.image?.mimeType).toBe('image/png');
  });

  it(
    'модель не ответила — отказ с повтором; ничего не нашли — «Не нашли показатели»',
    async () => {
      const failing = await setup(extractorOf(null));
      const failed = await call(failing.app, 'POST', KPI, flagged, { kind: 'text', text: TEXT });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.retryable).toBe(true);

      const empty = await setup(extractorOf({ sourceText: '', rows: [] }));
      const none = await call(empty.app, 'POST', KPI, flagged, { kind: 'text', text: TEXT });
      expect(none.statusCode).toBe(422);
      expect(none.json().error.code).toBe('kpi_rows_not_found');
    },
    SLOW,
  );

  it('принятые строки становятся целями один раз; вес не на 100 % — отказ', async () => {
    const { app } = await setup(extractorOf(ANSWER));
    const draft = (await call(app, 'POST', KPI, flagged, { kind: 'text', text: TEXT })).json().data;
    const uneven = await call(app, 'POST', `${KPI}/${draft.id}/accept`, flagged, {
      rows: [ACCEPT_ROW],
    });
    expect(uneven.statusCode).toBe(422);
    expect(uneven.json().error.code).toBe('kpi_weight_sum');

    const rows = [
      ACCEPT_ROW,
      { ...ACCEPT_ROW, title: 'Закрыто вакансий', unit: '', targetValue: 2 },
    ];
    const accepted = await call(app, 'POST', `${KPI}/${draft.id}/accept`, flagged, { rows });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json().data.goalIds).toHaveLength(2);
    const again = await call(app, 'POST', `${KPI}/${draft.id}/accept`, flagged, { rows });
    expect(again.json().data.goalIds).toEqual(accepted.json().data.goalIds);

    const cards = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data.items;
    expect(cards.map((card: { title: string }) => card.title).sort()).toEqual([
      'Закрыто вакансий',
      'Срок релиза',
    ]);
    expect(cards.find((card: { title: string }) => card.title === 'Срок релиза')).toMatchObject({
      dueDate: '2027-01-31',
      details: { setBy: 'manager', weight: 50, quarterTargets: null },
    });

    // Прод 22.11: id вида `kpi:<импорт>:<n>` не проходил проверку uuid — замер и удаление 400.
    const goalId = accepted.json().data.goalIds[0] as string;
    expect(goalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const measured = await call(app, 'POST', `${DIARY}/goals/${goalId}/measurements`, flagged, {
      value: 3,
      measuredAt: '2026-11-20',
    });
    expect(measured.statusCode, measured.body).toBe(201);
  });

  it('B742: вклад кварталов годовой строки уходит в детали цели', async () => {
    const { app } = await setup(extractorOf(ANSWER));
    const draft = (await call(app, 'POST', KPI, flagged, { kind: 'text', text: TEXT })).json().data;
    const quarterTargets = [
      { quarter: 1, value: 85 },
      { quarter: 2, value: 88 },
    ];
    const rows = [{ ...ACCEPT_ROW, horizon: 'year', weight: 100, quarterTargets }];
    const accepted = await call(app, 'POST', `${KPI}/${draft.id}/accept`, flagged, { rows });
    expect(accepted.statusCode, accepted.body).toBe(201);
    const [card] = (await call(app, 'GET', `${DIARY}/goal-cards`, flagged)).json().data.items;
    expect(card.details.quarterTargets).toEqual(quarterTargets);
  });

  it('цель, принятая до правки с id `kpi:…`, замеряется и удаляется', async () => {
    const { app, store, candidate } = await setup(extractorOf(ANSWER));
    const legacy = `kpi:${randomUUID()}:0`;
    store.careerDiaryRepo.createGoal(
      candidate,
      {
        type: 'operational',
        horizon: 'quarter',
        startDate: '2026-11-01',
        dueDate: '2026-12-31',
        title: 'Срок релиза',
        unit: 'дней',
        baselineValue: 10,
        targetValue: 5,
      },
      undefined,
      legacy,
    );
    const path = `${DIARY}/goals/${encodeURIComponent(legacy)}`;
    const measured = await call(app, 'POST', `${path}/measurements`, flagged, {
      value: 7,
      measuredAt: '2026-11-20',
    });
    expect(measured.statusCode, measured.body).toBe(201);
    expect((await call(app, 'DELETE', path, flagged)).statusCode).toBe(200);
  });

  it(
    'неудачные разборы тоже идут в суточный предел',
    async () => {
      const extractor = extractorOf(null);
      const { app } = await setup(extractor);
      const results = await Promise.all(
        Array.from({ length: 31 }, () =>
          call(app, 'POST', KPI, flagged, { kind: 'text', text: TEXT }),
        ),
      );
      const codes = results.map((response) => response.statusCode);
      expect(codes.filter((code) => code === 502)).toHaveLength(30);
      expect(codes.filter((code) => code === 429)).toHaveLength(1);
      expect(extractor.extract).toHaveBeenCalledTimes(30);
    },
    SLOW,
  );

  it('исходник стирается по запросу, черновик остаётся', async () => {
    const { app, databasePath } = await setup(extractorOf(ANSWER));
    const draft = (await call(app, 'POST', KPI, flagged, { kind: 'text', text: TEXT })).json().data;
    const deleted = await call(app, 'DELETE', `${KPI}/${draft.id}/source`, flagged);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.sourceStored).toBe(false);
    expect(deleted.json().data.rows[0].quote).toBe('');
    expect((await call(app, 'GET', `${KPI}/${draft.id}`, flagged)).json().data).toMatchObject({
      sourceStored: false,
      rows: [{ title: 'Срок релиза' }, { title: 'Закрыто вакансий' }],
    });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare('SELECT source_cipher FROM career_diary_kpi_imports').get() as {
      source_cipher: null;
    };
    database.close();
    expect(row.source_cipher).toBeNull();
    const after = (await call(app, 'GET', `${KPI}/${draft.id}`, flagged)).json().data;
    expect(after.rows.map((item: { quote: string }) => item.quote)).toEqual(['', '']);
    expect(after.sourceName).toBeNull();
    expect((await call(app, 'DELETE', `${KPI}/${SOME_ID}/source`, flagged)).statusCode).toBe(404);
  });
});
