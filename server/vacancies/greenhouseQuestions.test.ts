import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  greenhouseJobRef,
  readGreenhouseQuestions,
  resetGreenhouseQuestionsCache,
} from './greenhouseQuestions';

beforeEach(() => resetGreenhouseQuestionsCache());

const provenance = (sourceId: string, externalId?: string) => ({
  provenance: { sourceType: 'json_api' as never, sourceId, sourceUrl: '', externalId, observedAt: '' },
});

describe('B641: вакансия Greenhouse', () => {
  it('узнаёт доску и номер вакансии', () => {
    expect(greenhouseJobRef(provenance('ats-greenhouse-nova-labs', '4012345'))).toEqual({
      board: 'nova-labs',
      jobId: '4012345',
    });
  });

  it('B641: вакансия из другого источника узнаётся по адресу доски, в том числе в домене EU', () => {
    const at = (url: string) => greenhouseJobRef({ ...provenance('corporate-prolific', 'x'), url });
    const ref = { board: 'prolific', jobId: '5041667101' };
    for (const host of ['job-boards.eu', 'boards.eu', 'job-boards', 'boards']) {
      expect(at(`https://${host}.greenhouse.io/prolific/jobs/5041667101?gh_src=a`)).toEqual(ref);
    }
    for (const bad of [
      'http://job-boards.eu.greenhouse.io/prolific/jobs/1',
      'https://job-boards.eu.greenhouse.io.evil.example/prolific/jobs/1',
      'https://user:pass@job-boards.eu.greenhouse.io/prolific/jobs/1',
      'https://job-boards.eu.greenhouse.io:8443/prolific/jobs/1',
      'https://job-boards.eu.greenhouse.io/prolific/jobs/abc',
      'https://job-boards.eu.greenhouse.io/a%2Fb/jobs/1',
      'https://job-boards.eu.greenhouse.io/prolific',
      'не адрес',
    ]) {
      expect(at(bad), bad).toBeNull();
    }
  });

  it('другая площадка, пустой или нечисловой номер не подходят', () => {
    expect(greenhouseJobRef(provenance('ats-ashby-snowflake', '1'))).toBeNull();
    expect(greenhouseJobRef(provenance('ats-greenhouse-acme'))).toBeNull();
    expect(greenhouseJobRef(provenance('ats-greenhouse-acme', '../../etc'))).toBeNull();
    expect(greenhouseJobRef(provenance('hh', '1'))).toBeNull();
    expect(greenhouseJobRef(undefined)).toBeNull();
  });
});

describe('B641: чтение вопросов Greenhouse', () => {
  const ref = { board: 'acme', jobId: '77' };
  const question = { label: 'Why us?', required: true, fields: [{ name: 'question_1', type: 'textarea' }] };

  it('ходит только на открытый адрес Greenhouse и не следует перенаправлениям', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ questions: [question] })));
    const questions = await readGreenhouseQuestions(ref, fetchImpl as never);
    expect(questions).toEqual([{ id: 'question_1', text: 'Why us?', required: true, kind: 'text' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs/77?questions=true');
    expect(init.redirect).toBe('error');
  });

  it('ошибка сети, плохой статус, мусор и слишком большой ответ дают null', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => { throw new Error('offline'); },
      async () => new Response('nope', { status: 500 }),
      async () => new Response('<html>'),
      async () => new Response('x'.repeat(600_000)),
    ];
    for (const run of cases) {
      resetGreenhouseQuestionsCache();
      expect(await readGreenhouseQuestions(ref, run as never)).toBeNull();
    }
  });

  it('после сбоя ту же вакансию не читает повторно, другую — читает', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 429 }));
    expect(await readGreenhouseQuestions(ref, failing as never)).toBeNull();
    expect(await readGreenhouseQuestions(ref, failing as never)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
    const ok = vi.fn(async () => new Response(JSON.stringify({ questions: [question] })));
    expect(await readGreenhouseQuestions({ board: 'acme', jobId: '78' }, ok as never)).toHaveLength(1);
  });

  it('одновременные чтения одной вакансии идут одним запросом', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ questions: [question] })));
    const [a, b] = await Promise.all([
      readGreenhouseQuestions(ref, fetchImpl as never),
      readGreenhouseQuestions(ref, fetchImpl as never),
    ]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
