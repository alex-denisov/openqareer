import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { KPI_MODEL_JSON_SCHEMA } from '../domain/kpiImport';
import { buildKpiExtractor } from './kpiExtractor';
import type { VertexConfig } from './vertexAi';

const ANSWER = {
  sourceText: '',
  rows: [
    {
      title: 'Закрыто вакансий',
      target: '2',
      targetValue: 2,
      unit: 'шт.',
      dueDate: null,
      horizon: 'quarter',
      weight: null,
      setBy: null,
      quote: '2 вакансии закрыть',
    },
  ],
};

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const vertex: VertexConfig = {
  projectId: 'p',
  location: 'global',
  model: 'gemini-test',
  clientEmail: 'bot@p.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

function vertexFetch(answer: unknown, calls: unknown[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('token') || href.includes('oauth')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    }
    calls.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    );
  }) as unknown as typeof fetch;
}

function chatFetch(answer: unknown, calls: string[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
    );
  }) as unknown as typeof fetch;
}

describe('buildKpiExtractor', () => {
  it('без ключей и Vertex разбора нет', () => {
    expect(buildKpiExtractor({})).toBeUndefined();
  });

  it('текст: Vertex отвечает мусором — следующая ступень', async () => {
    const vertexCalls: unknown[] = [];
    const chatCalls: string[] = [];
    const failures: string[] = [];
    const extractor = buildKpiExtractor({
      vertex,
      vertexFetch: vertexFetch({ nope: true }, vertexCalls),
      providerCredentials: { openai: 'sk-test' },
      fetchImpl: chatFetch(ANSWER, chatCalls),
      onStageFailure: (label) => failures.push(label),
    })!;
    const answer = await extractor.extract({ text: '2 вакансии закрыть', today: '2026-11-19' });
    expect(answer?.rows[0]?.title).toBe('Закрыто вакансий');
    expect(failures).toEqual(['vertex:gemini-test']);
    expect(chatCalls[0]).toContain('/chat/completions');
  });

  it('ступень chat-completions получает схему ответа (прод 20.11: без неё invalid_answer)', async () => {
    let system = '';
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      system = JSON.parse(String(init?.body)).messages[0].content;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] }),
      );
    }) as unknown as typeof fetch;
    const extractor = buildKpiExtractor({ providerCredentials: { openai: 'sk-test' }, fetchImpl })!;
    await extractor.extract({ text: '2 вакансии закрыть', today: '2026-11-19' });
    expect(system).toContain(JSON.stringify(KPI_MODEL_JSON_SCHEMA));
  });

  it('фото уходит только в Vertex, картинкой в сообщении', async () => {
    const vertexCalls: Array<{ contents: Array<{ parts: unknown[] }> }> = [];
    const chatCalls: string[] = [];
    const extractor = buildKpiExtractor({
      vertex,
      vertexFetch: vertexFetch({ nope: true }, vertexCalls as unknown[]),
      providerCredentials: { openai: 'sk-test' },
      fetchImpl: chatFetch(ANSWER, chatCalls),
      onStageFailure: () => undefined,
    })!;
    const answer = await extractor.extract({
      text: '',
      image: { mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) },
      today: '2026-11-19',
    });
    expect(answer).toBeNull();
    expect(chatCalls).toEqual([]);
    expect(vertexCalls[0]?.contents[0]?.parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'AQID' },
    });
  });

  it('OpenRouter получает запрет на сбор данных', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] }),
      );
    }) as unknown as typeof fetch;
    const extractor = buildKpiExtractor({
      providerCredentials: { openrouter: 'or-test' },
      fetchImpl,
    })!;
    await extractor.extract({ text: '2 вакансии закрыть', today: '2026-11-19' });
    expect(bodies[0]?.provider).toEqual({ data_collection: 'deny' });
  });
});
