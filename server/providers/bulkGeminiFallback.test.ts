import { generateKeyPairSync } from 'node:crypto';
import { expect, it } from 'vitest';
import { VertexBulkFallback } from './bulkGeminiFallback';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = {
  projectId: 'p',
  clientEmail: 'sa@p.iam',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  model: 'gemini-3.8-flash',
  location: 'global',
};
function transport(answer: unknown, status = 200): typeof fetch {
  return (async (url: string | URL | Request) =>
    String(url).includes('oauth2')
      ? Response.json({ access_token: 't', expires_in: 3600 })
      : Response.json(answer, { status })) as typeof fetch;
}
const answer = (modelVersion: string) => ({
  modelVersion,
  candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
  usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100 },
});

it('returns the JSON text and prices tokens for the ledger', async () => {
  const fallback = new VertexBulkFallback(config, 0.5, 3, transport(answer('gemini-3.8-flash')));
  const result = await fallback.complete({ prefix: 's', input: 'i', maxTokens: 512 });
  expect(result.content).toBe('{"a":1}');
  expect(result.usage).toEqual({
    cost: 0.0014,
    promptTokens: 1000,
    cachedTokens: 0,
    completionTokens: 300,
  });
});

it('refuses an answer from another model and a failed status', async () => {
  await expect(
    new VertexBulkFallback(config, 0.5, 3, transport(answer('gemini-2.0-pro'))).complete({
      prefix: 's',
      input: 'i',
      maxTokens: 8,
    }),
  ).rejects.toThrow('Unexpected bulk fallback model');
  await expect(
    new VertexBulkFallback(config, 0.5, 3, transport({}, 403)).complete({
      prefix: 's',
      input: 'i',
      maxTokens: 8,
    }),
  ).rejects.toThrow('Bulk fallback status 403');
});

it('asks Vertex for a fixed seed, so a repeated call samples the same way (02.11)', async () => {
  const bodies: Array<{ generationConfig: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('oauth2')) return Response.json({ access_token: 't', expires_in: 3600 });
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(answer('gemini-3.8-flash'));
  }) as typeof fetch;
  const fallback = new VertexBulkFallback(config, 0.5, 3, fetchImpl);
  await fallback.complete({ prefix: 's', input: 'i', maxTokens: 512 });
  await fallback.complete({ prefix: 's', input: 'i', maxTokens: 512 });
  expect(bodies[0]!.generationConfig.seed).toEqual(expect.any(Number));
  expect(bodies[1]!.generationConfig.seed).toBe(bodies[0]!.generationConfig.seed);
});
