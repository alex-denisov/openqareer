import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteBulkLlmLedger } from '../data/sqliteBulkLlmLedger';
import { buildExperienceFactRewriter } from './experienceFactRewriter';
import { createMeteredVertexFetch } from './meteredVertexFetch';
import { chainStageLabel, MODEL_CHAINS } from './modelChains';
import { VERTEX_CHAT_TIMEOUTS_MS } from './vertexChatTimeouts';
import { createVertexGate, type VertexCreditConfig } from './vertexCredit';
import type { VertexConfig } from './vertexAi';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const creditConfig: VertexCreditConfig = {
  creditUsd: 1000,
  sinceIso: '2020-01-01T00:00:00.000Z',
  untilMs: Date.parse('2099-01-01T00:00:00Z'),
  dayUsd: 1000,
  catalogSummaryDayUsd: 1000,
};
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const vertex: VertexConfig = {
  projectId: 'p',
  clientEmail: 'sa@p.iam.gserviceaccount.com',
  privateKey,
  model: 'gemini-3.8-flash',
  location: 'global',
};
const credentials = {
  openai: 'sk-openai-test-key-long-enough',
  openrouter: 'sk-or-test-key-long-enough',
};

function gateAndLedger(patch: Partial<VertexCreditConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vchat-'));
  dirs.push(dir);
  const ledger = new SqliteBulkLlmLedger(join(dir, 'l.db'));
  return {
    ledger,
    gate: createVertexGate({
      ledger,
      config: { ...creditConfig, ...patch },
      env: {},
      log: vi.fn(),
    }),
  };
}

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** Transport under the meter: the OAuth endpoint answers a token, `generateContent` answers `text`. */
function transport(text: string | (() => Response), calls: Call[] = []) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('oauth2')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (typeof text !== 'string') return text();
    return Response.json({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      modelVersion: 'gemini-3.8-flash',
    });
  });
}

function metered(
  gate: ReturnType<typeof gateAndLedger>['gate'],
  task: string,
  inner: ReturnType<typeof transport>,
  timeoutMs = 5_000,
) {
  return createMeteredVertexFetch({ gate, task, timeoutMs, fetchImpl: inner as never });
}

const labels = (mechanic: keyof typeof MODEL_CHAINS) => MODEL_CHAINS[mechanic].map(chainStageLabel);

describe('цепочки без Vertex (выключен решением владельца 20.11)', () => {
  it.each([
    'coach',
    'coachFree',
    'resumeParsing',
    'skillQuizzes',
    'experienceBullets',
    'bulk',
    'campaignRoles',
    'kpiImport',
    'linkedinDrafts',
    'roleNames',
  ] as const)('%s: без Vertex', (mechanic) => {
    expect(labels(mechanic)).not.toContain('vertex');
  });

  it('цепочки диалога и хвосты прежние', () => {
    expect(labels('coach')).toEqual([
      'openrouter:deepseek/deepseek-v4.1-flash-1017',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openai:gpt-5.6-luna',
    ]);
    expect(labels('coachFree')).toEqual([
      'openrouter:z-ai/glm-5.3-flash',
      'openrouter:deepseek/deepseek-v4.1-flash',
    ]);
    expect(labels('skillQuizzes')).toEqual(labels('coach'));
    expect(labels('resumeParsing')).toEqual([
      'openai:gpt-5.6-luna',
      'openrouter:deepseek/deepseek-v4.1-flash',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
    expect(labels('experienceBullets')).toEqual([
      'openai:gpt-5.6-luna',
      'openrouter:z-ai/glm-5.3-flash',
    ]);
  });

  it('потолки Vertex: кандидату хватает времени на следующую ступень', () => {
    expect(VERTEX_CHAT_TIMEOUTS_MS.experienceBullets).toBe(30_000);
  });
});

describe('пункты резюме: Vertex не зовётся и когда настроен', () => {
  it('ни одного вызова Vertex, расхода Gemini в журнале нет', async () => {
    const { gate, ledger } = gateAndLedger();
    const calls: Call[] = [];
    const built = buildExperienceFactRewriter({
      providerCredentials: credentials,
      vertex,
      vertexFetch: metered(gate, 'experienceBullets', transport('{}', calls)),
    })!;
    expect(built.provenance?.model).not.toBe('gemini-3.8-flash');
    expect(calls).toEqual([]);
    expect(
      ledger.db.prepare("SELECT task FROM bulk_llm_spend WHERE provider='gemini'").all(),
    ).toEqual([]);
  });
});
