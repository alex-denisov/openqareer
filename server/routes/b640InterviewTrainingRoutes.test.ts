import { afterEach, describe, expect, it } from 'vitest';
import {
  createInterviewSession,
  recordInterviewAnswer,
  scoreInterviewAnswer,
} from '../domain/interviewSimulator';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const BASE = '/api/v1/candidate/b640/interview-sessions';
const NOW = '2026-11-19T10:00:00.000Z';
const SD_ANSWER =
  'Требования: 2000 платежей в секунду и latency до 300 мс. Компоненты: API, очередь и база. ' +
  'Я выбрал очередь, потому что нужна повторная доставка. Метрики и алерты на ошибки.';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Harness = Awaited<ReturnType<typeof createB640Harness>>;

function seedSession(harness: Harness, user: HarnessUser, description?: string) {
  const store = harness.candidates;
  const candidateId = harness.candidateIds[user];
  const application =
    description === undefined
      ? null
      : store.createApplication(candidateId, {
          clusterId: `b681-${user}`,
          stage: 'applied',
          manualVacancy: {
            title: 'Go-разработчик',
            company: 'Арка Пэй',
            url: 'https://example.test/1',
            source: 'hh.ru',
            description,
          },
        });
  const session = createInterviewSession({
    id: `session-${user}`,
    mode: 'text',
    roleTitle: 'Инженер данных',
    applicationId: application?.id ?? null,
    vacancyTitle: application?.vacancy?.title,
    questionTypes: ['system_design', 'behavioral'],
    stressMode: false,
    stories: [],
    verifiedSkills: [],
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    now: NOW,
  });
  const answered = recordInterviewAnswer(
    session,
    SD_ANSWER,
    600,
    scoreInterviewAnswer(SD_ANSWER, 'system_design'),
    NOW,
  );
  store.interviewSimulatorRepo.create(candidateId, answered, NOW);
  store.addManualExperienceFact(candidateId, `fact-rps-${user}`, 'Держал 2000 платежей в секунду.');
  return { session: answered, candidateId };
}

async function setup() {
  const harness = await createB640Harness({ pool: () => [] });
  closers.push(harness.close);
  const call = (method: 'POST' | 'PUT', url: string, payload: unknown, user?: HarnessUser) =>
    harness.app.inject({
      method,
      url,
      payload: payload as object,
      headers: user ? { authorization: `Bearer ${harness.tokens[user]}` } : {},
    });
  return { ...harness, call };
}

describe('B681: задача System Design под вакансию', () => {
  it('answers 404 without the flag, a session or for another candidate', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test', 'Биллинг и платежи на Kafka.');
    seedSession(harness, 'plain.test', 'Биллинг');
    const task = `${BASE}/session-flagged.test/system-design-task`;
    expect((await harness.get(task)).statusCode).toBe(404);
    expect(
      (await harness.get(`${BASE}/session-plain.test/system-design-task`, 'plain.test')).statusCode,
    ).toBe(404);
    expect((await harness.get(task, 'other.test')).json().error.code).toBe(
      'interview_session_not_found',
    );
    const review = `${BASE}/session-flagged.test/questions/q1/review`;
    expect((await harness.call('POST', review, {}, 'plain.test')).statusCode).toBe(404);
    expect((await harness.call('POST', review, {}, 'other.test')).statusCode).toBe(404);
    const helpful = `${BASE}/session-flagged.test/questions/q1/helpful`;
    expect((await harness.call('PUT', helpful, { helpful: true }, 'plain.test')).statusCode).toBe(
      404,
    );
    expect((await harness.call('PUT', helpful, { helpful: true }, 'other.test')).statusCode).toBe(
      404,
    );
  });

  it('builds the task from the saved vacancy description', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test', 'Команда биллинга: платежи. Стек: Go, Kafka.');
    const response = await harness.get(
      `${BASE}/session-flagged.test/system-design-task`,
      'flagged.test',
    );
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.requestId).toBeTruthy();
    expect(body.data).toMatchObject({
      basis: 'vacancy',
      domain: 'payments',
      timeLimitMinutes: 45,
      stack: ['Go', 'Kafka'],
    });
    expect(body.data.prompt).toContain('«Go-разработчик»');
    expect(body.data).not.toHaveProperty('exampleAnswer');
  });

  it('falls back to the role without an application', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    const body = (
      await harness.get(`${BASE}/session-flagged.test/system-design-task`, 'flagged.test')
    ).json();
    expect(body.data).toMatchObject({ basis: 'role', domain: 'core_api' });
    expect(body.data.prompt).toContain('«Инженер данных»');
  });

  it('reviews an answered question with quotes, numbers and the example answer, without writing', async () => {
    const harness = await setup();
    const { session, candidateId } = seedSession(harness, 'flagged.test', 'Платежи');
    const response = await harness.call(
      'POST',
      `${BASE}/session-flagged.test/questions/q1/review`,
      {},
      'flagged.test',
    );
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    for (const criterion of Object.values(data.evaluation.criteria) as Array<{
      points: number;
      quote?: string;
    }>) {
      if (criterion.points > 0) expect(SD_ANSWER).toContain(criterion.quote);
    }
    expect(data.numbers).toContainEqual(
      expect.objectContaining({ value: '2000', matchedFactId: 'fact-rps-flagged.test' }),
    );
    expect(data.numbers).toContainEqual({
      value: '300',
      matchedFactId: null,
      matchedFactStatement: null,
    });
    expect(data.exampleAnswer).toContain('Компромисс');
    expect(data.helpful).toBeNull();
    expect(harness.candidates.interviewSimulatorRepo.get(candidateId, session.id)).toEqual(
      expect.objectContaining({ version: session.version, questions: session.questions }),
    );
  });

  it('refuses an unanswered or unknown question', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test', 'Платежи');
    const unanswered = await harness.call(
      'POST',
      `${BASE}/session-flagged.test/questions/q2/review`,
      {},
      'flagged.test',
    );
    expect(unanswered.statusCode).toBe(409);
    expect(unanswered.json().error.code).toBe('interview_question_unanswered');
    const unknown = await harness.call(
      'POST',
      `${BASE}/session-flagged.test/questions/nope/review`,
      {},
      'flagged.test',
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('stores «разбор помог» once per question and validates the body', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test', 'Платежи');
    const url = `${BASE}/session-flagged.test/questions/q1/helpful`;
    expect((await harness.call('PUT', url, { helpful: true }, 'flagged.test')).json().data).toEqual(
      { helpful: true },
    );
    expect(
      (await harness.call('PUT', url, { helpful: false }, 'flagged.test')).json().data,
    ).toEqual({ helpful: false });
    const review = await harness.call(
      'POST',
      `${BASE}/session-flagged.test/questions/q1/review`,
      {},
      'flagged.test',
    );
    expect(review.json().data.helpful).toBe(false);
    for (const body of [{}, { helpful: 'yes' }, { helpful: true, extra: 1 }]) {
      expect((await harness.call('PUT', url, body, 'flagged.test')).statusCode).toBe(400);
    }
    expect(
      (
        await harness.call(
          'PUT',
          `${BASE}/session-flagged.test/questions/q2/helpful`,
          { helpful: true },
          'flagged.test',
        )
      ).statusCode,
    ).toBe(409);
  });
});
