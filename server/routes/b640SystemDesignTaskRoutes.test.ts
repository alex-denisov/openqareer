import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemDesignTask } from '../domain/systemDesignTask';
import { createInterviewSession } from '../domain/interviewSimulator';
import { createB640Harness, type HarnessUser } from '../testHelpers/b640VacancyHarness';

const URL = '/api/v1/candidate/b640/interview-tasks';
const NOW = '2026-11-23T01:00:00.000Z';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  vi.unstubAllGlobals();
});

const MODEL_TASK = {
  title: 'Ассистент на LLM для 5 000 сотрудников',
  service: 'сервис ответов по внутренним документам',
  scope: 'ответы сотрудникам по документам компании со ссылками на источники',
  points: [
    'Поиск по документам (RAG) и свежесть индекса',
    'Оценка качества ответов и защита от выдумок',
    'Права доступа к документам',
    'Задержка и стоимость вызовов модели',
  ],
  requirements: 'сколько документов и пользователей, допустимая задержка ответа',
  components: 'загрузка документов, векторный индекс, сервис ответов, журнал оценок',
  tradeoff: 'малая модель на простые вопросы дешевле, большая — на сложные',
  operations: 'контрольный набор вопросов, лимиты расходов, запасная модель',
};

function stubModel(...answers: unknown[]) {
  const queue = [...answers];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (next === undefined) return new Response('down', { status: 503 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(next) } }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Harness = Awaited<ReturnType<typeof createB640Harness>>;

async function setup(withModel: boolean) {
  const harness = await createB640Harness({
    pool: () => [],
    ...(withModel ? { providerCredentials: { openrouter: 'test-key' } } : {}),
  });
  closers.push(harness.close);
  const ask = (payload: unknown, user: HarnessUser = 'flagged.test') =>
    harness.app.inject({
      method: 'POST',
      url: URL,
      payload: payload as object,
      headers: { authorization: `Bearer ${harness.tokens[user]}` },
    });
  return { ...harness, ask };
}

function seedGenAi(harness: Harness, user: HarnessUser = 'flagged.test') {
  return harness.candidates.createApplication(harness.candidateIds[user], {
    clusterId: `b750-${user}`,
    stage: 'applied',
    manualVacancy: {
      title: 'GenAI Architect',
      company: 'Himalayas',
      url: 'https://example.test/genai',
      source: 'Himalayas',
      description:
        'We build generative AI products for enterprise clients. Remote, flexible hours.',
    },
  });
}

describe('B750 · POST interview-tasks: задача System Design под вакансию', () => {
  it('без флага, без отклика и с кривым телом — нет задачи', async () => {
    const harness = await setup(false);
    const application = seedGenAi(harness, 'plain.test');
    expect((await harness.ask({ applicationId: application.id }, 'plain.test')).statusCode).toBe(
      404,
    );
    expect((await harness.ask({ applicationId: 'missing' })).json().error.code).toBe(
      'application_not_found',
    );
    expect((await harness.ask({})).statusCode).toBe(400);
  });

  it('без модели GenAI Architect получает задачу семьи ML/GenAI из четырёх пунктов, и она не меняется', async () => {
    const harness = await setup(false);
    const application = seedGenAi(harness);
    const first = await harness.ask({ applicationId: application.id });
    expect(first.statusCode).toBe(200);
    const task = first.json().data;
    expect(task).toMatchObject({ domain: 'ml_genai', origin: 'rules', timeLimitMinutes: 45 });
    expect(task.points).toHaveLength(4);
    expect(task.title).not.toBe('Основной API продукта');
    expect(task).not.toHaveProperty('exampleAnswer');
    expect((await harness.ask({ applicationId: application.id })).json().data).toEqual(task);
  });

  it('модель пишет задачу по вакансии один раз; тренировка и разбор видят ту же', async () => {
    const fetchMock = stubModel(MODEL_TASK);
    const harness = await setup(true);
    const application = seedGenAi(harness);
    const task = (await harness.ask({ applicationId: application.id })).json().data;
    expect(task).toMatchObject({
      origin: 'model',
      title: MODEL_TASK.title,
      points: MODEL_TASK.points,
    });
    expect((await harness.ask({ applicationId: application.id })).json().data).toEqual(task);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const candidateId = harness.candidateIds['flagged.test'];
    const session = createInterviewSession({
      id: 'session-b750',
      mode: 'text',
      roleTitle: 'GenAI Architect',
      applicationId: application.id,
      vacancyTitle: 'GenAI Architect',
      questionTypes: ['system_design'],
      stressMode: false,
      stories: [],
      verifiedSkills: [],
      questionIds: ['q1'],
      now: NOW,
    });
    harness.candidates.interviewSimulatorRepo.create(candidateId, session, NOW);
    const read = await harness.get(
      '/api/v1/candidate/b640/interview-sessions/session-b750/system-design-task',
      'flagged.test',
    );
    expect(read.json().data).toEqual(task);
  });

  it('ответ модели не по схеме — шаблон, и он остаётся', async () => {
    stubModel(
      { ...MODEL_TASK, points: MODEL_TASK.points.slice(0, 2) },
      { ...MODEL_TASK, title: 'LLM assistant' },
    );
    const harness = await setup(true);
    const application = seedGenAi(harness);
    const task = (await harness.ask({ applicationId: application.id })).json().data;
    expect(task).toMatchObject({ origin: 'rules', domain: 'ml_genai' });
    expect(task.points).toHaveLength(4);
  });

  it('B635: сохранённая задача другого вида заменяется, пока на неё не ответили', async () => {
    const harness = await setup(false);
    const candidateId = harness.candidateIds['flagged.test'];
    const application = harness.candidates.createApplication(candidateId, {
      clusterId: 'b635-ses',
      stage: 'applied',
      manualVacancy: {
        title: 'Технический директор / Ведущий инженер СЭС (СНЭ)',
        company: 'Intouch Group',
        url: 'https://example.test/ses',
        source: 'hh.ru',
      },
    });
    const { caseKind: _kind, ...old } = buildSystemDesignTask({ vacancyTitle: 'Тимлид' });
    const key = { candidateId, applicationId: application.id };
    harness.candidates.interviewSimulatorRepo.designTasks.keep(key, old, NOW);
    const task = (await harness.ask({ applicationId: application.id })).json().data;
    expect(task).toMatchObject({ caseKind: 'leadership', domain: 'leadership' });
    expect((await harness.ask({ applicationId: application.id })).json().data).toEqual(task);
  });
});
