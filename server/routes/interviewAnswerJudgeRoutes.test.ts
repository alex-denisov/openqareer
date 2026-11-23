import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JudgeInput, Judgement } from '../domain/interviewAnswerJudge';
import {
  createInterviewSession,
  recordInterviewAnswer,
  scoreInterviewAnswer,
} from '../domain/interviewSimulator';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

/** B780: маршруты i02 и i03 берут критерии у модели, правила — когда модели нет. */
const OLD = '/api/v1/candidate/interview-sessions';
const B640 = '/api/v1/candidate/b640/interview-sessions';
const NOW = '2026-11-23T10:00:00.000Z';
const STAR =
  'В 2023 году я руководил переводом платёжного сервиса в Kubernetes. Цель — убрать ночные простои при выпуске. ' +
  'Я разбил переход на четыре этапа, договорился с бизнесом об окнах и вёл команду из 12 человек. ' +
  'Время выпуска сократилось с 4 часов до 20 минут.';
const DESIGN =
  'Требования: 2000 платежей в секунду и latency до 300 мс. Компоненты: API, очередь и база. ' +
  'Я выбрал очередь, потому что нужна повторная доставка. Метрики и алерты на ошибки.';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Harness = Awaited<ReturnType<typeof createB640Harness>>;

function stubJudge(answer: (input: JudgeInput) => Judgement | null) {
  const judge = vi.fn(async (input: JudgeInput) => answer(input));
  return { judge };
}

function seed(
  harness: Harness,
  user: HarnessUser,
  types: Array<'behavioral' | 'system_design'>,
  answer?: string,
) {
  const candidateId = harness.candidateIds[user];
  const session = createInterviewSession({
    id: `b780-${user}`,
    mode: 'text',
    roleTitle: 'Руководитель разработки',
    applicationId: null,
    questionTypes: types,
    stressMode: false,
    stories: [],
    verifiedSkills: [],
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    now: NOW,
  });
  const stored = answer
    ? recordInterviewAnswer(session, answer, 300, scoreInterviewAnswer(answer, types[0]!), NOW)
    : session;
  harness.candidates.interviewSimulatorRepo.create(candidateId, stored, NOW);
  return stored;
}

async function setup(judge: ReturnType<typeof stubJudge>) {
  const harness = await createB640Harness({ pool: () => [], interviewAnswerJudge: judge });
  closers.push(harness.close);
  const call = (url: string, payload: unknown, user: HarnessUser = 'flagged.test') =>
    harness.app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: { authorization: `Bearer ${harness.tokens[user]}`, origin: 'http://localhost:3000' },
    });
  return { ...harness, call };
}

describe('B780: i02 — ответ оценивает модель, оценка сохраняется', () => {
  it('сохраняет «есть» модели с цитатой и зовёт модель один раз на ответ', async () => {
    const judge = stubJudge(() => ({
      situation: {
        points: 2,
        reason: 'Роль ясна',
        quote: 'я руководил переводом платёжного сервиса',
      },
      task: {
        points: 2,
        reason: 'Цель названа',
        quote: 'Цель — убрать ночные простои при выпуске',
      },
      action: {
        points: 2,
        reason: 'Свои шаги: этапы, бизнес, команда',
        quote: 'Я разбил переход на четыре этапа',
      },
      result: {
        points: 2,
        reason: 'Результат в числах',
        quote: 'сократилось с 4 часов до 20 минут',
      },
    }));
    const harness = await setup(judge);
    const session = seed(harness, 'flagged.test', ['behavioral']);
    const response = await harness.call(`${OLD}/${session.id}/answers`, {
      expectedVersion: session.version,
      questionId: session.questions[0]!.id,
      answer: STAR,
      elapsedSeconds: 120,
    });
    expect(response.statusCode).toBe(200);
    const evaluation = response.json().data.session.questions[0].answer.evaluation;
    expect(evaluation.points).toBe(8);
    expect(evaluation.criteria.action).toEqual({
      points: 2,
      reason: 'Свои шаги: этапы, бизнес, команда',
      quote: 'Я разбил переход на четыре этапа',
    });
    expect(judge.judge).toHaveBeenCalledTimes(1);
    expect(judge.judge.mock.calls[0]![0]).toMatchObject({ type: 'behavioral', answer: STAR });
  });

  it('модель недоступна — сохраняется оценка правил', async () => {
    const judge = stubJudge(() => {
      throw new Error('provider down');
    });
    const harness = await setup(judge);
    const session = seed(harness, 'flagged.test', ['behavioral']);
    const response = await harness.call(`${OLD}/${session.id}/answers`, {
      expectedVersion: session.version,
      questionId: session.questions[0]!.id,
      answer: STAR,
      elapsedSeconds: 120,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.session.questions[0].answer.evaluation).toEqual(
      scoreInterviewAnswer(STAR, 'behavioral'),
    );
  });
});

describe('B780: i03 — «Требования» сверяются с «Что важно в задаче»', () => {
  it('передаёт модели пункты задачи и отдаёт её решение с цитатой', async () => {
    const judge = stubJudge(() => ({
      requirements: {
        points: 2,
        reason: 'Нагрузка и задержка учтены',
        quote: '2000 платежей в секунду',
      },
    }));
    const harness = await setup(judge);
    const session = seed(harness, 'flagged.test', ['system_design', 'behavioral'], DESIGN);
    const response = await harness.call(
      `${B640}/${session.id}/questions/${session.questions[0]!.id}/review`,
      {},
    );
    expect(response.statusCode).toBe(200);
    const evaluation = response.json().data.evaluation;
    expect(evaluation.criteria.requirements).toMatchObject({
      points: 2,
      reason: 'Нагрузка и задержка учтены',
      quote: '2000 платежей в секунду',
    });
    const input = judge.judge.mock.calls[0]![0];
    expect(input.type).toBe('system_design');
    expect(input.answer).toBe(DESIGN);
    expect(input.taskPoints?.length).toBeGreaterThan(0);
  });
});
