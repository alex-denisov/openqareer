import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCoverLetterWriter } from './coverLetterWriter';
import { GeminiCoverLetterWriter } from './geminiCoverLetterWriter';
import { readVertexConfig, VertexTokenProvider, vertexPublisherBaseUrl } from './vertexAi';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  project_id: 'proj-1',
  client_email: 'bot@proj-1.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const encoded = Buffer.from(JSON.stringify(serviceAccount)).toString('base64');

describe('Vertex AI (B266, решение владельца 25.09)', () => {
  it('читает ключ сервисного аккаунта из base64 и ставит gemini-3.8-flash на глобальный адрес', () => {
    const config = readVertexConfig({ OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64: encoded });

    expect(config).toMatchObject({
      projectId: 'proj-1',
      model: 'gemini-3.8-flash',
      location: 'global',
    });
    expect(vertexPublisherBaseUrl(config!)).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google',
    );
    expect(readVertexConfig({})).toBeUndefined();
    expect(() =>
      readVertexConfig({ OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64: 'bm90IGpzb24=' }),
    ).toThrow();
  });

  it('выпускает токен один раз и отдаёт его из кеша до конца срока', async () => {
    const config = readVertexConfig({ OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64: encoded })!;
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
    );
    let now = 1_000_000;
    const tokens = new VertexTokenProvider(config, fetchImpl as unknown as typeof fetch, () => now);

    await expect(Promise.all([tokens.token(), tokens.token()])).resolves.toEqual(['tok', 'tok']);
    now += 50 * 60 * 1000;
    await tokens.token();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 10 * 60 * 1000;
    await tokens.token();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ступень Vertex шлёт токен и thinkingLevel low, повторяет один раз после 429', async () => {
    const replies = [
      new Response('{"error":{"code":429}}', { status: 429 }),
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify({ body: 'One. Two.' }) }] },
            },
          ],
        }),
      ),
    ];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const writer = new GeminiCoverLetterWriter({
      apiKey: '',
      model: 'gemini-3.8-flash',
      baseUrl: 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google',
      authHeaders: async () => ({ Authorization: 'Bearer tok' }),
      thinkingLevel: 'low',
      retriesOn429: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const outcome = await writer.writeCoverLetter({
      language: 'en',
      tone: 'executive',
      vacancy: { title: 'CTO' },
      facts: [{ ref: 'f1', statement: 'VP of Technology' }],
    });

    expect(outcome.body).toBe('One. Two.');
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['x-goog-api-key']).toBeUndefined();
    expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'low',
    });
  });

  it('очередь письма ставит Vertex первым', () => {
    const writer = buildCoverLetterWriter({
      personalProvider: 'openrouter',
      providerCredentials: { openrouter: 'o' },
      vertex: readVertexConfig({ OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64: encoded }),
    }) as unknown as { descriptors: readonly string[] };

    expect(writer.descriptors[0]).toBe('vertex:gemini-3.8-flash');
  });
});
