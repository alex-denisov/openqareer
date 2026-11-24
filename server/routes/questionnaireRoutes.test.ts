import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import {
  QUESTIONNAIRE_MAX_PER_CANDIDATE,
  SqliteQuestionnaireRepository,
  type StoredQuestionnaire,
} from '../candidate/sqliteQuestionnaireRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { isQuestionnaireFresh, mergeReadQuestions } from './questionnaireRoutes';

const HH_FORM = {
  url: 'https://spb.hh.ru/applicant/vacancy_response?vacancyId=77&token=x',
  questions: [
    { text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' },
    { text: 'Готовы к командировкам?', required: true, kind: 'choice', options: ['Да', 'Нет'] },
  ],
};

const ATS_FORM = {
  url: 'https://jobs.lever.co/acme/fca52e03-9e9d-4dcd-bda8-c27dbdd0e0a4/apply',
  questions: [
    { id: 'ats-1', text: 'Full name', required: true, kind: 'text', known: 'Марина Соколова' },
    { id: 'ats-2', text: 'Why us?', required: true, kind: 'text' },
    { id: 'ats-3', text: 'Country', required: true, kind: 'choice', options: ['Spain', 'Italy'] },
  ],
};

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const flagged = 'token-flagged';
const plain = 'token-plain';
const other = 'token-other';
const url = (vacancy: string, tail = '') =>
  `/api/v1/candidate/vacancies/${vacancy}/questionnaire${tail}`;
const QUESTIONS = [
  {
    id: 'q1',
    text: 'Сколько человек было в вашей команде?',
    required: true,
    kind: 'text' as const,
  },
  { id: 'q2', text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' as const },
  { id: 'q3', text: 'Готовы ли к командировкам?', required: false, kind: 'text' as const },
];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-questionnaire-'));
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
    [plain, principal('plain.test')],
    [other, principal('other.test')],
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
  });
  const forms = new SqliteQuestionnaireRepository({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => forms.close(),
    () => app.close(),
  );
  /** Вопросы, как если бы их прочитали у площадки. */
  const seed = (token: string, vacancyId: string) =>
    forms.saveQuestions(sessions.get(token)!.candidate!.id, vacancyId, {
      questions: QUESTIONS,
      formUrl: 'https://boards.greenhouse.io/acme/jobs/77',
      readAt: '2026-11-17T00:00:00.000Z',
    });
  return { app, seed, forms, sessions, candidateStore, databasePath: config.databasePath };
}

function call(
  app: App,
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: path,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

function rows(
  databasePath: string,
): Array<{ answers_cipher: string | null; submitted_at: string | null }> {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare('SELECT answers_cipher, submitted_at FROM application_questionnaires')
      .all() as never;
  } finally {
    database.close();
  }
}

describe('questionnaire routes without the B640 flag', () => {
  it('answer like a missing address and write nothing', async () => {
    const { app, seed, databasePath } = await setup();
    seed(plain, 'v1');
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    const routes: ReadonlyArray<['GET' | 'PUT' | 'POST', string, unknown?]> = [
      ['GET', url('v1')],
      ['PUT', url('v1', '/answers'), { answers: [{ questionId: 'q1', text: 'x' }] }],
      ['PUT', url('v1', '/hh-form'), HH_FORM],
      ['PUT', url('v1', '/ats-form'), ATS_FORM],
      ['POST', url('v1', '/submitted')],
    ];
    for (const [method, path, payload] of routes) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, path, token, payload);
        expect(response.statusCode, `${method} ${path}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(rows(databasePath)).toEqual([{ answers_cipher: null, submitted_at: null }]);
  });

  it('leave the old vacancy routes as they were', async () => {
    const { app } = await setup();
    const fit = await call(app, 'GET', '/api/v1/candidate/vacancies/v1/fit', plain);
    const fitFlagged = await call(app, 'GET', '/api/v1/candidate/vacancies/v1/fit', flagged);
    expect(fit.statusCode).toBe(fitFlagged.statusCode);
    expect(fit.json().error?.code).toBe(fitFlagged.json().error?.code);
  });
});

describe('questionnaire routes with the B640 flag', () => {
  it('says there is no questionnaire for an unknown vacancy and stores nothing', async () => {
    const { app, databasePath } = await setup();
    const response = await call(app, 'GET', url('v-unknown'), flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      state: 'none',
      questions: [],
      total: 0,
      formUrl: null,
    });
    expect(rows(databasePath)).toEqual([]);
  });

  it('keeps the stored questions when a day-old questionnaire cannot be read again', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const database = new DatabaseSync(databasePath);
    database
      .prepare("UPDATE application_questionnaires SET read_at = '2026-01-01T00:00:00.000Z'")
      .run();
    database.close();
    expect((await call(app, 'GET', url('v1'), flagged)).json().data).toMatchObject({
      state: 'ready',
      total: 3,
    });
  });

  it('returns questions with readiness and saves answers sealed', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const first = (await call(app, 'GET', url('v1'), flagged)).json().data;
    expect(first).toMatchObject({ state: 'ready', total: 3, answered: 0, missingRequired: 2 });
    expect(first.formUrl).toBe('https://boards.greenhouse.io/acme/jobs/77');
    const saved = await call(app, 'PUT', url('v1', '/answers'), flagged, {
      answers: [
        { questionId: 'q1', text: '  9 человек  ' },
        { questionId: 'gone', text: 'мимо' },
        { questionId: 'q3', text: '' },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ answered: 1, missingRequired: 1 });
    expect(saved.json().data.answers).toEqual([{ questionId: 'q1', text: '9 человек' }]);
    const again = (await call(app, 'GET', url('v1'), flagged)).json().data;
    expect(again.answers).toEqual([{ questionId: 'q1', text: '9 человек' }]);
    const cipher = rows(databasePath)[0].answers_cipher;
    expect(cipher).toBeTruthy();
    expect(cipher).not.toContain('человек');
  });

  it('fills answers from the profile contacts and names the source', async () => {
    const { app, forms, sessions, candidateStore } = await setup();
    const candidateId = sessions.get(flagged)!.candidate!.id;
    candidateStore.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        candidate: {
          fullName: 'Марина Соколова',
          contact: {
            phone: '+7 916 245-18-07',
            location: 'Москва, Россия',
            linkedinUrl: 'https://www.linkedin.com/in/msokolova',
            links: ['https://sokolova.dev', 'javascript:alert(1)'],
          },
        },
      },
      [],
    );
    forms.saveQuestions(candidateId, 'v2', {
      questions: [
        { id: 'q1', text: 'LinkedIn Profile', required: true, kind: 'text' },
        {
          id: 'q2',
          text: 'Country of residence',
          required: true,
          kind: 'choice',
          options: ['Germany', 'Россия'],
        },
        { id: 'q3', text: 'Website', required: false, kind: 'text' },
        { id: 'q4', text: 'Are you authorized to work in the EU?', required: true, kind: 'text' },
      ],
      formUrl: 'https://boards.greenhouse.io/acme/jobs/78',
      readAt: new Date().toISOString(),
    });
    const data = (await call(app, 'GET', url('v2'), flagged)).json().data;
    expect(data.answers).toEqual([
      { questionId: 'q1', text: 'https://www.linkedin.com/in/msokolova' },
      { questionId: 'q2', text: 'Россия' },
      { questionId: 'q3', text: 'https://sokolova.dev' },
    ]);
    expect(data).toMatchObject({ answered: 3, total: 4, missingRequired: 1 });
    expect(data.suggestions.map((item: { source: string }) => item.source)).toEqual([
      'Из контактов вашего профиля',
      'Из контактов вашего профиля',
      'Из контактов вашего профиля',
    ]);
    // Кандидат написал своё: источник у этого ответа больше не показывается.
    const saved = await call(app, 'PUT', url('v2', '/answers'), flagged, {
      answers: [{ questionId: 'q1', text: 'linkedin.com/in/other' }],
    });
    expect(saved.json().data.answers[0]).toEqual({
      questionId: 'q1',
      text: 'linkedin.com/in/other',
    });
    expect(
      saved.json().data.suggestions.map((item: { questionId: string }) => item.questionId),
    ).toEqual(['q2', 'q3']);
    // Другой кандидат чужих контактов не получает.
    forms.saveQuestions(sessions.get(other)!.candidate!.id, 'v2', {
      questions: [{ id: 'q1', text: 'LinkedIn Profile', required: true, kind: 'text' }],
      formUrl: null,
      readAt: new Date().toISOString(),
    });
    expect((await call(app, 'GET', url('v2'), other)).json().data.answers).toEqual([]);
  });

  it('B641: fills LinkedIn from a profile link written without https', async () => {
    const { app, forms, sessions, candidateStore } = await setup();
    const candidateId = sessions.get(flagged)!.candidate!.id;
    candidateStore.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        candidate: { contact: { links: ['linkedin.com/in/msokolova', 'javascript:alert(1)'] } },
      },
      [],
    );
    forms.saveQuestions(candidateId, 'v3', {
      questions: [{ id: 'q1', text: 'LinkedIn Profile', required: true, kind: 'text' }],
      formUrl: null,
      readAt: new Date().toISOString(),
    });
    const data = (await call(app, 'GET', url('v3'), flagged)).json().data;
    expect(data.answers).toEqual([{ questionId: 'q1', text: 'https://linkedin.com/in/msokolova' }]);
  });

  it('B641: reads a stored list cut at 30 options again, keeping a complete or submitted one', () => {
    const now = Date.parse('2026-11-24T12:00:00.000Z');
    const stored = (
      count: number,
      submittedAt: string | null = null,
      readAt = '2026-11-24T04:54:00.000Z',
    ): StoredQuestionnaire => ({
      vacancyId: 'v1',
      formUrl: null,
      questions: [
        {
          id: 'q1',
          text: 'Country',
          required: true,
          kind: 'choice',
          options: Array.from({ length: count }, (_, index) => `C${index}`),
        },
      ],
      answers: [{ questionId: 'q1', text: 'C1' }],
      readAt,
      submittedAt,
    });
    expect(isQuestionnaireFresh(stored(30), now)).toBe(false);
    expect(isQuestionnaireFresh(stored(255), now)).toBe(true);
    expect(isQuestionnaireFresh(stored(30, '2026-11-21T00:00:00.000Z'), now)).toBe(true);
    // Прочитанный уже целиком список ровно из 30 вариантов не перечитывается при каждом заходе.
    const later = Date.parse('2026-11-25T12:00:00.000Z');
    expect(isQuestionnaireFresh(stored(30, null, '2026-11-25T10:00:00.000Z'), later)).toBe(true);
  });

  it('B641: a repeated read takes the full list and keeps answered questions the board dropped', () => {
    const question = (id: string, count: number) => ({
      id,
      text: id,
      required: true,
      kind: 'choice' as const,
      options: Array.from({ length: count }, (_, index) => `C${index}`),
    });
    const merged = mergeReadQuestions(
      {
        questions: [question('q1', 30), question('gone', 2), question('empty', 2)],
        answers: [
          { questionId: 'q1', text: 'C1' },
          { questionId: 'gone', text: 'C0' },
          { questionId: 'empty', text: '' },
        ],
      },
      [question('q1', 255)],
    );
    expect(merged.map((item) => [item.id, item.options?.length])).toEqual([
      ['q1', 255],
      ['gone', 2],
    ]);
    expect(mergeReadQuestions(null, [question('q1', 255)])).toHaveLength(1);
  });

  it('keeps one candidate away from another candidate questionnaire', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    await call(app, 'PUT', url('v1', '/answers'), flagged, {
      answers: [{ questionId: 'q1', text: 'моё' }],
    });
    expect((await call(app, 'GET', url('v1'), other)).json().data.state).toBe('none');
    expect(
      (
        await call(app, 'PUT', url('v1', '/answers'), other, {
          answers: [{ questionId: 'q1', text: 'чужое' }],
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(app, 'POST', url('v1', '/submitted'), other)).statusCode).toBe(404);
    expect(rows(databasePath)).toHaveLength(1);
    expect((await call(app, 'GET', url('v1'), flagged)).json().data.answers[0].text).toBe('моё');
  });

  it('rejects malformed answers and overlong text', async () => {
    const { app, seed } = await setup();
    seed(flagged, 'v1');
    const bad: unknown[] = [
      { answers: 'x' },
      { answers: [{ questionId: 'q1' }] },
      { answers: [{ questionId: 'q1', text: 'x'.repeat(4001) }] },
      { answers: [{ questionId: 'q1', text: 'x', extra: 1 }] },
      { answers: Array.from({ length: 41 }, () => ({ questionId: 'q1', text: 'x' })) },
    ];
    for (const payload of bad) {
      expect((await call(app, 'PUT', url('v1', '/answers'), flagged, payload)).statusCode).toBe(
        400,
      );
    }
    expect((await call(app, 'GET', url('x'.repeat(201)), flagged)).statusCode).toBe(400);
  });

  it('marks the questionnaire as submitted by the candidate', async () => {
    const { app, seed } = await setup();
    expect((await call(app, 'POST', url('v1', '/submitted'), flagged)).statusCode).toBe(404);
    seed(flagged, 'v1');
    const done = await call(app, 'POST', url('v1', '/submitted'), flagged);
    expect(done.statusCode).toBe(200);
    expect((await call(app, 'GET', url('v1'), flagged)).json().data.submittedAt).toBe(
      done.json().data.submittedAt,
    );
  });

  it('refuses a write from a foreign origin', async () => {
    const { app, seed, databasePath } = await setup();
    seed(flagged, 'v1');
    const response = await app.inject({
      method: 'PUT',
      url: url('v1', '/answers'),
      headers: { cookie: `openqareer_session=${flagged}`, origin: 'https://evil.example' },
      payload: { answers: [{ questionId: 'q1', text: 'x' }] },
    });
    expect(response.statusCode).toBe(403);
    expect(rows(databasePath)[0].answers_cipher).toBeNull();
  });
});

describe('B641: анкета hh.ru из окна кандидата', () => {
  it('сохраняет вопросы своему кандидату; адрес — только страница с номером вакансии', async () => {
    const { app, candidateStore, sessions } = await setup();
    candidateStore.decisionProfileRepo.put(
      sessions.get(flagged)!.candidate!.id,
      {
        salaryFloor: 500000,
        salaryCurrency: 'RUB',
        workFormats: [],
      } as never,
      '2026-11-24T00:00:00.000Z',
    );
    const saved = await call(app, 'PUT', url('v1', '/hh-form'), flagged, HH_FORM);
    expect(saved.statusCode).toBe(200);
    const data = saved.json().data;
    expect(data).toMatchObject({
      state: 'ready',
      formUrl: 'https://spb.hh.ru/applicant/vacancy_response?vacancyId=77',
      total: 2,
      suggestions: [{ text: 'от 500 000 ₽', source: 'Ожидания из вашего профиля' }],
    });
    expect((await call(app, 'GET', url('v1'), flagged)).json().data.total).toBe(2);
    expect((await call(app, 'GET', url('v1'), other)).json().data.total).toBe(0);

    // Вопрос сменился — прежний ответ не оказывается под новым.
    const [first] = data.questions;
    const answers = [{ questionId: first.id, text: 'от 600 000 ₽' }];
    await call(app, 'PUT', url('v1', '/answers'), flagged, { answers });
    const changed = {
      ...HH_FORM,
      questions: [{ text: 'Срок выхода?', required: true, kind: 'text' }],
    };
    const next = (await call(app, 'PUT', url('v1', '/hh-form'), flagged, changed)).json().data;
    const fresh = next.questions.find((item: { text: string }) => item.text === 'Срок выхода?');
    expect(next.answers.map((item: { questionId: string }) => item.questionId)).not.toContain(
      fresh.id,
    );
  });

  it.each([
    ['чужой сайт', { ...HH_FORM, url: 'https://evilhh.ru/vacancy/77' }],
    ['http', { ...HH_FORM, url: 'http://hh.ru/vacancy/77' }],
    ['другая страница', { ...HH_FORM, url: 'https://hh.ru/resume/77' }],
    ['без вопросов', { ...HH_FORM, questions: [] }],
    ['лишнее поле', { ...HH_FORM, html: '<form>' }],
    [
      'вариантов слишком много',
      {
        ...HH_FORM,
        questions: Array.from({ length: 4 }, (_, i) => ({
          text: `Вопрос ${i}`,
          required: true,
          kind: 'choice',
          options: Array.from({ length: 200 }, (_o, j) => `Вариант ${j}`),
        })),
      },
    ],
    [
      'выбор без вариантов',
      { ...HH_FORM, questions: [{ text: 'А?', required: true, kind: 'choice' }] },
    ],
  ])('отклоняет: %s', async (_name, body) => {
    const { app, databasePath } = await setup();
    expect((await call(app, 'PUT', url('v1', '/hh-form'), flagged, body)).statusCode).toBe(400);
    expect((await call(app, 'PUT', url('v1', '/hh-form'), undefined, HH_FORM)).statusCode).not.toBe(
      200,
    );
    expect(rows(databasePath)).toEqual([]);
  });

  it('число анкет на кандидата ограничено: старые без ответов вытесняются первыми', async () => {
    const { app, databasePath, sessions } = await setup();
    const candidateId = sessions.get(flagged)!.candidate!.id;
    const repo = new SqliteQuestionnaireRepository({
      databasePath,
      encryptionKey: baseConfig.dataEncryptionKey,
    });
    const questions = [{ id: 'q', text: 'А?', kind: 'text' as const, required: true }];
    const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    for (let n = 0; n < QUESTIONNAIRE_MAX_PER_CANDIDATE; n += 1) {
      repo.saveQuestions(candidateId, `old-${n}`, { questions, formUrl: null, readAt: at(n) });
    }
    repo.saveAnswers(candidateId, 'old-0', [{ questionId: 'q', text: 'мой ответ' }]);
    const saved = await call(app, 'PUT', url('v1', '/hh-form'), flagged, HH_FORM);
    expect(saved.statusCode).toBe(200);
    const kept = repo.exportAll(candidateId).map((item) => item.vacancyId);
    expect(kept).toHaveLength(QUESTIONNAIRE_MAX_PER_CANDIDATE);
    expect(kept).toContain('old-0');
    expect(kept).not.toContain('old-1');
    expect(kept).toContain('v1');
    repo.close();
  });
});

describe('B787: форма работодателя из приложения', () => {
  it('заменяет вопросы, ставит данные профиля и не возвращает стёртое', async () => {
    const { app, seed } = await setup();
    seed(flagged, 'v1');
    const read = await call(app, 'PUT', url('v1', '/ats-form'), flagged, ATS_FORM);
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toMatchObject({
      state: 'ready',
      total: 3,
      missingRequired: 2,
      answers: [{ questionId: 'ats-1', text: 'Марина Соколова' }],
    });
    const answers = [
      { questionId: 'ats-1', text: '' },
      { questionId: 'ats-3', text: 'Italy' },
    ];
    await call(app, 'PUT', url('v1', '/answers'), flagged, { answers });
    const again = await call(app, 'PUT', url('v1', '/ats-form'), flagged, ATS_FORM);
    expect(again.json().data.answers).toEqual([{ questionId: 'ats-3', text: 'Italy' }]);
    expect((await call(app, 'GET', url('v1'), other)).json().data.total).not.toBe(3);
  });

  it.each([
    { ...ATS_FORM, url: 'http://jobs.lever.co/x' },
    { ...ATS_FORM, questions: [] },
    { ...ATS_FORM, questions: [{ ...ATS_FORM.questions[0], id: 'a b' }] },
    { ...ATS_FORM, extra: 1 },
  ])('не принимает чужое %#', async (body) => {
    const { app } = await setup();
    const response = await call(app, 'PUT', url('v1', '/ats-form'), flagged, body);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_ats_form');
  });
});
