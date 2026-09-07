import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type { ResumeStructurer } from './providers/resumeStructurer';
import type { ResumeStudioProjection } from './domain/resumeStudio';
import type { ParsedResume } from '../src/features/workspace/resumeParser';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 5),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
  secureCookies: false,
  allowedOrigins: ['http://localhost:3000'],
  seedAccounts: [],
};

const noSessions: SessionAuth = {
  async register() {
    throw new Error('registration unavailable in this test double');
  },
  async login() {
    return null;
  },
  isUsernameTaken() {
    return false;
  },
  authenticate() {
    return null;
  },
  logout() {},
};

const unusedProvider: CoachProvider = {
  async createTurn() {
    throw new Error('importing a resume must not start a coach turn');
  },
};

/** A real LinkedIn export, reduced to what the extractor hands over. */
const LINKEDIN_MARKDOWN = `<!-- Page 1 -->

# Contact

+7 900 000 0000 (Home) qa.candidate@example.test

# Marina Orlova

VP of Technology & Operations

## Summary

I build and scale technology organizations.

<!-- Page 2 -->

## Experience

OptiLab AI Independent AI Consultant November 2025 - Present (10 months)

- Founded an independent AI advisory practice.

## Education

Universitatea Tehnică a Moldovei Bachelor of Engineering-BE · (2005 - 2010)
`;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp(resumeStructurer?: ResumeStructurer) {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    config,
    coachProvider: unusedProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
    resumeStructurer,
  });
  apps.push(app);
  stores.push(store);
  return {
    app,
    store,
    candidateId: candidate.id,
    authorization: `Bearer ${candidate.accessToken}`,
  };
}

function importBody(text = LINKEDIN_MARKDOWN) {
  return { text, source: 'linkedin' as const, fileName: 'linkedin.pdf' };
}

function nativeHhImportBody(text = LINKEDIN_MARKDOWN) {
  return {
    text,
    source: 'hh' as const,
    sourceReceipt: {
      platform: 'hh' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: 'https://hh.ru/resume/synthetic-resume-731',
      capturedAt: '2026-08-23T12:00:00.000Z',
    },
  };
}

function nativeLinkedInImportBody(text = LINKEDIN_MARKDOWN) {
  return {
    text,
    source: 'linkedin' as const,
    sourceReceipt: {
      platform: 'linkedin' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate-731/',
      capturedAt: '2026-08-24T12:00:00.000Z',
    },
  };
}

describe('POST /api/v1/candidate/resume/import', () => {
  it('commits a native hh snapshot and exposes a reload-visible session connection', async () => {
    const { app, authorization } = await createApp();

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: nativeHhImportBody(),
    });

    expect(imported.statusCode).toBe(200);
    expect(imported.json().data.connection).toMatchObject({
      platform: 'hh',
      status: 'connected',
      accessMode: 'native_session_snapshot',
      factCount: expect.any(Number),
    });

    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    const hh = connections
      .json()
      .data.find((connection: { platform: string }) => connection.platform === 'hh');
    expect(hh).toMatchObject({
      platform: 'hh',
      status: 'connected',
      accessMode: 'native_session_snapshot',
      factCount: expect.any(Number),
    });
    expect(hh).not.toHaveProperty('scopes');
    expect(hh).not.toHaveProperty('accessTokenExpiresAt');
    expect(hh).not.toHaveProperty('profile');
  });

  it('commits a bounded native LinkedIn profile with the same persisted receipt contract', async () => {
    const { app, authorization } = await createApp();

    const imported = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: nativeLinkedInImportBody(),
    });

    expect(imported.statusCode).toBe(200);
    expect(imported.json().data.connection).toMatchObject({
      platform: 'linkedin',
      status: 'connected',
      accessMode: 'native_session_snapshot',
      factCount: expect.any(Number),
    });
    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(connections.json().data[0]).toMatchObject({
      platform: 'linkedin',
      status: 'connected',
      accessMode: 'native_session_snapshot',
    });
    expect(connections.json().data[0]).not.toHaveProperty('profile');
    expect(connections.json().data[0]).not.toHaveProperty('scopes');
  });

  it('deduplicates a retried native hh import and keeps the receipt tenant-scoped', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const body = nativeHhImportBody();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: body,
    });
    const memoryAfterFirst = store.getSnapshot(candidateId).memory.length;
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: body,
    });

    expect(store.getSnapshot(candidateId).memory).toHaveLength(memoryAfterFirst);
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const foreignConnections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(
      foreignConnections
        .json()
        .data.find((connection: { platform: string }) => connection.platform === 'hh'),
    ).toMatchObject({ platform: 'hh', status: 'disconnected' });
  });

  it('deduplicates an exact native retry before paying for model structuring again', async () => {
    let structureCalls = 0;
    const { app, authorization } = await createApp({
      async structure() {
        structureCalls += 1;
        return null;
      },
    });
    const body = nativeHhImportBody();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: body,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: body,
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(structureCalls).toBe(1);
    expect(replay.json().data.connection).toMatchObject({
      platform: 'hh',
      status: 'connected',
      accessMode: 'native_session_snapshot',
    });
  });

  it('disconnects only the native receipt and retains imported candidate data', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: nativeHhImportBody(),
    });
    const before = store.getSnapshot(candidateId);

    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/connections/hh',
      headers: { authorization, origin: 'http://localhost:3000' },
    });

    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json().data).toEqual({
      platform: 'hh',
      status: 'disconnected',
      accessMode: 'native_session_snapshot',
      connectionRemoved: true,
      providerSession: 'not_managed',
      importedData: 'retained',
    });
    expect(store.getSnapshot(candidateId)).toMatchObject({
      memory: before.memory,
      resume: before.resume,
    });
    const connections = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    expect(
      connections
        .json()
        .data.find((connection: { platform: string }) => connection.platform === 'hh'),
    ).toMatchObject({ platform: 'hh', status: 'disconnected' });
  });

  it('exports safe native receipt metadata without its private storage payload', async () => {
    const { app, authorization } = await createApp();
    const body = nativeHhImportBody();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: body,
    });

    const exported = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/export',
      headers: { authorization },
    });

    expect(exported.statusCode).toBe(200);
    expect(exported.json().data.sourceConnections).toMatchObject([
      {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        capturedAt: body.sourceReceipt.capturedAt,
        factCount: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(exported.json().data.sourceConnections)).not.toContain(
      body.sourceReceipt.sourceUrl,
    );
    expect(exported.json().data.sourceConnections[0]).not.toHaveProperty('receipt');
    expect(exported.json().data.sourceConnections[0]).not.toHaveProperty('importDigest');
    expect(exported.json().data.sourceConnections[0]).not.toHaveProperty('receiptCipher');
  });

  it('accepts ordinary imports without creating a native connection and rejects forged receipts', async () => {
    const { app, authorization } = await createApp();

    const ordinary = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: { ...importBody(), source: 'hh' },
    });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().data).not.toHaveProperty('connection');

    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: {
        ...nativeHhImportBody(),
        sourceReceipt: {
          ...nativeHhImportBody().sourceReceipt,
          sourceUrl: 'https://attacker.example/resume/731',
        },
      },
    });
    expect(forged.statusCode).toBe(422);

    const crossPlatform = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: {
        ...nativeHhImportBody(),
        sourceReceipt: {
          ...nativeHhImportBody().sourceReceipt,
          sourceUrl: 'https://www.linkedin.com/in/wrong-provider/',
        },
      },
    });
    expect(crossPlatform.statusCode).toBe(422);
  });

  it('holds the projected resume back until the candidate confirms the facts', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.statusCode).toBe(200);
    // A resume claim is something the candidate stands behind, so nothing the
    // machine merely read may appear in it before review (B166).
    const onImport = response.json().data.resume.projection as ResumeStudioProjection;
    expect(onImport.master.experience).toEqual([]);
    expect(onImport.master.education).toEqual([]);
    expect(onImport.master.unknowns).toContainEqual(
      expect.objectContaining({
        code: 'ineligible-evidence',
        message: 'Факт ещё не подтверждён кандидатом — подтвердите его на «Главной».',
      }),
    );

    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/memory/review',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {
        action: 'confirm',
        memoryIds: store.getSnapshot(candidateId).memory.map((item) => item.id),
      },
    });
    expect(reviewed.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    const projection = read.json().data.projection as ResumeStudioProjection;
    expect(projection.master.experience.length).toBeGreaterThan(0);
    expect(projection.master.education.length).toBeGreaterThan(0);
    // Nothing may be silently thrown away for want of a resolvable source.
    expect(projection.excludedEvidenceIds).toEqual([]);
  });

  it('records what the document stated as dossier evidence awaiting the candidate', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    const memory = store.getSnapshot(candidateId).memory;
    expect(memory.length).toBeGreaterThan(0);
    // The machine read the document; only the candidate can confirm it (B166).
    expect(memory.every((item) => item.status === 'proposed')).toBe(true);
    expect(memory.every((item) => item.sourceMessageIds.length > 0)).toBe(true);
  });

  it('survives a reimport of the same document without duplicating facts', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });
    const first = store.getSnapshot(candidateId).memory.length;
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    // Every import mints fresh ids, so the second upload used to leave the
    // first one's facts behind and the dossier doubled — the test asserted the
    // defect it was named after (B162).
    expect(store.getSnapshot(candidateId).memory.length).toBe(first);
    expect(
      new Set(store.getSnapshot(candidateId).memory.map((item) => item.id)).size,
    ).toBe(first);
  });

  it('keeps a corrected fact when a later upload replaces the import', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });
    const [firstFact] = store.getSnapshot(candidateId).memory;
    store.changeMemory(candidateId, firstFact.id, {
      action: 'correct',
      statement: 'Кандидат уточнил эту формулировку сам.',
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    const kept = store
      .getSnapshot(candidateId)
      .memory.find((item) => item.id === firstFact.id);
    expect(kept?.statement).toBe('Кандидат уточнил эту формулировку сам.');
  });

  it('prefers the model reading when a structurer is configured', async () => {
    const structured: ParsedResume = {
      fullName: 'Marina Orlova',
      targetRole: 'VP of Technology',
      contact: { links: [] },
      experience: [
        {
          title: 'VP of Technology',
          employer: 'Enterprise Energy IT Services',
          startDate: '2023-04',
          endDate: '2025-10',
          current: false,
          responsibilities: ['Rebuilt ITIL 4 processes'],
          achievements: [],
        },
      ],
      skills: ['ITIL'],
      education: [],
      courses: [],
      tests: [],
      recommendations: [],
      languages: [],
      rawText: LINKEDIN_MARKDOWN,
    };
    const { app, authorization } = await createApp({
      structure: async () => structured,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.json().meta ?? {}).toBeDefined();
    expect(response.json().data.structuredBy).toBe('model');
    expect(response.json().data.parsed.experience[0].employer).toBe(
      'Enterprise Energy IT Services',
    );
  });

  it('falls back to the rules parser when the model produces nothing', async () => {
    const { app, authorization } = await createApp({ structure: async () => null });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.structuredBy).toBe('rules');
  });

  it('refuses a document that carries no fact instead of storing an empty resume', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody('. . . . . . . . . .'),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('resume_without_facts');
  });

  it('refuses an anonymous import', async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      payload: importBody(),
    });

    // The origin guard answers before authentication, so an unsigned request
    // is refused as an untrusted origin rather than as a missing session.
    expect(response.statusCode).toBe(403);
  });

  it('hands the model the same repaired text the rules parser reads (B178)', async () => {
    const seen: string[] = [];
    const recordingStructurer: ResumeStructurer = {
      async structure(sourceText: string) {
        seen.push(sourceText);
        return null;
      },
    };
    const { app, authorization } = await createApp(recordingStructurer);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(
        [
          'Иванова Мария',
          'Проживает : Казань',
          'maria.ivanova@example.com',
          'Желаемая должность и зарплата',
          'Директор по маркетингу ( CMO )',
        ].join('\n'),
      ),
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('Проживает: Казань');
    expect(seen[0]).toContain('Директор по маркетингу (CMO)');
    expect(seen[0]).not.toContain('Проживает :');
  });
});

/**
 * INC-037 — у импорта не было потолка времени. На проде 2026-09-07 разбор шёл
 * 389 секунд и всё равно откатился на правила: кандидат ждал шесть с половиной
 * минут ради результата, который правила дают сразу.
 */
describe('INC-037 · импорт не ждёт модель дольше своего бюджета', () => {
  it('отдаёт разбор правилами, когда модель молчит дольше бюджета', async () => {
    // Боевой бюджет — 45 секунд; проверке важен не он, а то, что потолок есть.
    process.env.OPENQAREER_RESUME_STRUCTURING_BUDGET_MS = '400';
    let released: (() => void) | undefined;
    const slow: ResumeStructurer = {
      structure: () =>
        new Promise((resolve) => {
          released = () => resolve(null);
        }),
    };
    const { app, authorization } = await createApp(slow);

    const started = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(
        [
          'Иван Синтетов — Senior Software Engineer',
          'ООО «Финтех Платформа», Москва — Senior Software Engineer',
          'Март 2021 — настоящее время',
          'Веду платформенную команду из шести инженеров.',
          'Стек: TypeScript, React, Node.js, PostgreSQL.',
        ].join('\n'),
      ),
    });
    const elapsed = Date.now() - started;
    released?.();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.structuredBy).toBe('rules');
    // Бюджет в тестах короткий; важно, что ответ не ждёт зависшую модель.
    expect(elapsed).toBeLessThan(5_000);
  });
});
