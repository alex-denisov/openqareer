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
  'Требования: 2000 платежей в секунду. Клиент → шлюз API → сервис платежей. ' +
  'Сервис платежей пишет события в Kafka. Воркер читает из очереди и кладёт итог в PostgreSQL. ' +
  'Метрики и алерты на ошибки.';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

type Harness = Awaited<ReturnType<typeof createB640Harness>>;

function seedSession(harness: Harness, user: HarnessUser, answer = SD_ANSWER) {
  const session = createInterviewSession({
    id: `session-${user}`,
    mode: 'text',
    roleTitle: 'Инженер',
    applicationId: null,
    questionTypes: ['system_design', 'behavioral'],
    stressMode: false,
    stories: [],
    verifiedSkills: [],
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    now: NOW,
  });
  const answered = recordInterviewAnswer(
    session,
    answer,
    600,
    scoreInterviewAnswer(answer, 'system_design'),
    NOW,
  );
  harness.candidates.interviewSimulatorRepo.create(harness.candidateIds[user], answered, NOW);
  return answered;
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

const SCHEMA_URL = `${BASE}/session-flagged.test/questions/q1/schema`;

describe('B647: схема System Design на тренировке', () => {
  it('answers 404 without the flag or for another candidate', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    seedSession(harness, 'plain.test');
    expect((await harness.get(SCHEMA_URL)).statusCode).toBe(404);
    expect(
      (await harness.get(`${BASE}/session-plain.test/questions/q1/schema`, 'plain.test'))
        .statusCode,
    ).toBe(404);
    expect((await harness.get(SCHEMA_URL, 'other.test')).statusCode).toBe(404);
    const put = { corrections: [{ op: 'remove_node', nodeId: 'cache' }] };
    expect((await harness.call('PUT', SCHEMA_URL, put, 'other.test')).statusCode).toBe(404);
  });

  it('shows the schema built from the answer', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    const response = await harness.get(SCHEMA_URL, 'flagged.test');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.meta.requestId).toBeTruthy();
    expect(body.data.source).toBe('answer');
    expect(body.data.schema.nodes.map((node: { id: string }) => node.id)).toEqual(
      expect.arrayContaining(['client', 'gateway', 'queue', 'worker', 'database', 'monitoring']),
    );
    expect(body.data.schema.links).toContainEqual(
      expect.objectContaining({ from: 'worker', to: 'database' }),
    );
  });

  it('stores corrections and serves them in the schema and the review', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    const put = await harness.call(
      'PUT',
      SCHEMA_URL,
      {
        corrections: [
          { op: 'rename_node', nodeId: 'queue', label: 'RabbitMQ' },
          { op: 'remove_node', nodeId: 'monitoring' },
          { op: 'add_link', from: 'client', to: 'database', label: 'чтение' },
        ],
      },
      'flagged.test',
    );
    expect(put.statusCode).toBe(200);
    expect(put.json().data.source).toBe('corrected');
    const read = (await harness.get(SCHEMA_URL, 'flagged.test')).json().data;
    expect(read.source).toBe('corrected');
    expect(read.schema.nodes.find((node: { id: string }) => node.id === 'queue').label).toBe(
      'RabbitMQ',
    );
    const review = (
      await harness.call(
        'POST',
        `${BASE}/session-flagged.test/questions/q1/review`,
        {},
        'flagged.test',
      )
    ).json().data;
    expect(review.schema).toEqual(read);
    expect(review.evaluation.criteria.architecture.schemaNodeIds?.length ?? 0).toBeGreaterThan(0);
    expect(review.evaluation.criteria.operations.schemaNodeIds ?? []).not.toContain('monitoring');
  });

  it('accepts a full schema and keeps quotes only for known nodes', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    const put = await harness.call(
      'PUT',
      SCHEMA_URL,
      {
        schema: {
          nodes: [
            { id: 'client', label: 'Клиент', kind: 'client' },
            { id: 'cdn', label: 'CDN', kind: 'cdn' },
          ],
          links: [{ from: 'client', to: 'cdn' }],
        },
      },
      'flagged.test',
    );
    expect(put.statusCode).toBe(200);
    const nodes = put.json().data.schema.nodes;
    expect(nodes[0].quote).toContain('Клиент');
    expect(nodes[1].quote).toBeNull();
  });

  it('validates the body and the ids', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test');
    const tooMany = Array.from({ length: 21 }, (_, index) => ({
      id: `n${index}`,
      label: 'x',
      kind: 'service',
    }));
    for (const body of [
      {},
      { corrections: [] },
      { corrections: [{ op: 'rename_node', nodeId: 'queue', label: 'x'.repeat(61) }] },
      { schema: { nodes: tooMany, links: [] } },
      { corrections: [{ op: 'drop' }] },
    ]) {
      const response = await harness.call('PUT', SCHEMA_URL, body, 'flagged.test');
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_interview_schema');
    }
    const unknown = await harness.call(
      'PUT',
      SCHEMA_URL,
      { corrections: [{ op: 'remove_node', nodeId: 'search' }] },
      'flagged.test',
    );
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.code).toBe('interview_schema_unknown_node');
    expect((await harness.get(SCHEMA_URL, 'flagged.test')).json().data.source).toBe('answer');
  });

  it('is honest about a short answer: no schema, text-only review', async () => {
    const harness = await setup();
    seedSession(harness, 'flagged.test', 'Сделаю надёжно и быстро.');
    const read = (await harness.get(SCHEMA_URL, 'flagged.test')).json().data;
    expect(read).toEqual({ schema: null, source: 'answer' });
    const review = (
      await harness.call(
        'POST',
        `${BASE}/session-flagged.test/questions/q1/review`,
        {},
        'flagged.test',
      )
    ).json().data;
    expect(review.schema).toEqual({ schema: null, source: 'answer' });
    const corrections = await harness.call(
      'PUT',
      SCHEMA_URL,
      { corrections: [{ op: 'remove_node', nodeId: 'client' }] },
      'flagged.test',
    );
    expect(corrections.statusCode).toBe(409);
    expect(corrections.json().error.code).toBe('interview_schema_missing');
  });
});
