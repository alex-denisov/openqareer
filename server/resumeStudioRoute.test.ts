import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatResumeAsAtsText } from './domain/resumeAtsText';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider, CoachProviderResult } from './providers/coachProvider';
import type { StoredMemory } from './data/candidateStore';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  openAIKey: 'not-used-by-test',
  openRouterKey: 'not-used-by-test',
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 7),
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
    throw new Error('the resume studio must not call a language model');
  },
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

interface SeededMemory {
  statement: string;
  kind: 'fact' | 'preference';
  confirm: boolean;
  sensitive?: boolean;
}

const seededMemories: SeededMemory[] = [
  { statement: 'Руководила операциями Example GmbH с 2022 года.', kind: 'fact', confirm: true },
  {
    statement: 'Сократила цикл поставки на 30% без снижения контроля.',
    kind: 'fact',
    confirm: true,
  },
  { statement: 'Руководила направлением в Earlier AG.', kind: 'fact', confirm: true },
  {
    statement: 'Запустила операционный контур для первых десяти клиентов.',
    kind: 'fact',
    confirm: true,
  },
  { statement: 'Окончила Example University по программе MBA.', kind: 'fact', confirm: true },
  { statement: 'Подтвердила немецкий язык на уровне B2.', kind: 'fact', confirm: true },
  { statement: 'Возможно, удвоила выручку компании.', kind: 'fact', confirm: false },
  {
    statement: 'Содержит чувствительные персональные сведения.',
    kind: 'fact',
    confirm: true,
    sensitive: true,
  },
  { statement: 'Предпочитает гибридный формат работы.', kind: 'preference', confirm: true },
];

function providerResult(memories: SeededMemory[]): CoachProviderResult {
  return {
    provider: 'openrouter',
    model: 'nemotron-test',
    responseId: 'response-1',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    result: {
      message: 'Зафиксировали факты.',
      phase: 'evidence',
      memoryCandidates: memories.map((memory) => ({
        kind: memory.kind,
        domain: 'outcome' as const,
        statement: memory.statement,
        confidence: 'candidate-reported' as const,
        sourceMessageIds: ['85512ddf-962c-4a7c-a4cc-30a35d1e5847'],
        sensitive: memory.sensitive ?? false,
      })),
      nextQuestion: null,
      completeness: { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: null,
      actionProposals: [],
    },
  };
}

function seedMemory(
  store: SqliteCandidateStore,
  candidateId: string,
  memories: SeededMemory[] = seededMemories,
): Map<string, StoredMemory> {
  const idempotencyKey = randomUUID();
  store.startTurn(candidateId, idempotencyKey, {
    messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
    content: 'Расскажу об опыте.',
    phase: 'discovery',
  });
  store.completeTurn(candidateId, idempotencyKey, providerResult(memories));
  const stored = store.getSnapshot(candidateId).memory;
  const byStatement = new Map<string, StoredMemory>();
  for (const memory of stored) {
    const seed = memories.find((item) => item.statement === memory.statement);
    const confirmed =
      seed?.confirm === true
        ? store.changeMemory(candidateId, memory.id, { action: 'confirm' })
        : memory;
    byStatement.set(memory.statement, confirmed ?? memory);
  }
  return byStatement;
}

async function createApp() {
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

function memoryId(memories: Map<string, StoredMemory>, statement: string): string {
  const memory = memories.get(statement);
  if (!memory) throw new Error(`memory not seeded: ${statement}`);
  return memory.id;
}

function draftFor(memories: Map<string, StoredMemory>) {
  return {
    candidate: {
      fullName: 'Mila Example',
      contact: {
        email: 'mila@example.test',
        phone: '+49 000 000000',
        location: 'Berlin',
        links: ['https://example.test/mila'],
      },
    },
    targetRole: 'VP Technology & Operations',
    experience: [
      {
        id: 'earlier-role',
        chronologyMemoryId: memoryId(memories, 'Руководила направлением в Earlier AG.'),
        title: 'Operations Lead',
        employer: 'Earlier AG',
        startDate: '2018-01',
        endDate: '2021-12',
        current: false,
        bulletMemoryIds: [
          memoryId(memories, 'Запустила операционный контур для первых десяти клиентов.'),
        ],
      },
      {
        id: 'current-role',
        chronologyMemoryId: memoryId(memories, 'Руководила операциями Example GmbH с 2022 года.'),
        title: 'Technology & Operations Director',
        employer: 'Example GmbH',
        location: 'Berlin',
        startDate: '2022-01',
        current: true,
        bulletMemoryIds: [
          memoryId(memories, 'Сократила цикл поставки на 30% без снижения контроля.'),
          memoryId(memories, 'Возможно, удвоила выручку компании.'),
          memoryId(memories, 'Содержит чувствительные персональные сведения.'),
          memoryId(memories, 'Предпочитает гибридный формат работы.'),
        ],
      },
    ],
    education: [
      {
        id: 'mba',
        evidenceMemoryId: memoryId(memories, 'Окончила Example University по программе MBA.'),
        institution: 'Example University',
        qualification: 'MBA',
        endDate: '2017-06',
      },
    ],
    languages: [
      {
        id: 'german',
        evidenceMemoryId: memoryId(memories, 'Подтвердила немецкий язык на уровне B2.'),
        name: 'Deutsch',
        cefr: 'B2',
      },
    ],
  };
}

function headers(authorization: string) {
  return { authorization, origin: 'http://localhost:3000' };
}

function manualProfileDraft() {
  return {
    schemaVersion: 2 as const,
    candidate: { fullName: 'Candidate Example', contact: { links: [] } },
    targetRole: 'Platform Engineer',
    experience: [
      {
        id: 'e-manual-role',
        chronologyMemoryId: 'manual-role-evidence',
        title: 'Platform Engineer',
        employer: 'Example Systems',
        location: 'Remote',
        startDate: '2023-02',
        current: true,
        employmentType: 'Contract',
        workplaceType: 'remote' as const,
        skills: ['TypeScript', 'Rust'],
        bulletMemoryIds: [],
      },
    ],
    education: [
      {
        id: 'e-manual-education',
        evidenceMemoryId: 'manual-education-evidence',
        institution: 'Example Institute',
        qualification: 'BSc',
        startDate: '2018-01',
        endDate: '2022-06',
        description: 'Systems engineering.',
      },
    ],
    languages: [
      {
        id: 'e-manual-language',
        evidenceMemoryId: 'manual-language-evidence',
        name: 'French',
        cefr: 'B2' as const,
      },
    ],
    projects: [
      {
        id: 'project-manual01',
        name: 'Atlas Reporting Portal',
        description: 'Built a reporting portal for account teams.',
        employer: 'Example Systems',
        startDate: '2024-01',
        endDate: '2024-04',
        current: false,
        skills: ['TypeScript'],
      },
    ],
  };
}

describe('candidate resume studio API', () => {
  it('builds master and Germany variants only from the candidate confirmed evidence', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const memories = seedMemory(store, candidateId);

    const unauthorized = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
    });
    expect(unauthorized.statusCode).toBe(401);

    const empty = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.draft).toBeNull();
    expect(
      empty.json().data.projection.master.unknowns.map((item: { code: string }) => item.code),
    ).toEqual(
      expect.arrayContaining(['missing-full-name', 'missing-contact', 'missing-role-chronology']),
    );

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: draftFor(memories),
    });
    expect(saved.statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(response.statusCode).toBe(200);
    const { projection, draft } = response.json().data;
    expect(draft.candidate.fullName).toBe('Mila Example');
    expect(projection.master.experience.map((role: { id: string }) => role.id)).toEqual([
      'earlier-role',
      'current-role',
    ]);
    expect(projection.germanyVariant.experience.map((role: { id: string }) => role.id)).toEqual([
      'current-role',
      'earlier-role',
    ]);
    expect(projection.germanyVariant.conventions).toMatchObject({
      country: 'DE',
      packVersion: 'DE-CV-2026.1',
      maxPages: 2,
      photo: 'omitted',
      discriminatoryPii: 'omitted',
    });

    const bullets = projection.germanyVariant.experience.flatMap(
      (role: { bullets: Array<{ value: string; memoryId: string; sourceMessageIds: string[] }> }) =>
        role.bullets,
    );
    expect(bullets.length).toBe(2);
    expect(
      bullets.every(
        (bullet: { memoryId: string; sourceMessageIds: string[] }) =>
          bullet.memoryId.length > 0 && bullet.sourceMessageIds.length > 0,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('удвоила выручку');
    expect(serialized).not.toContain('чувствительные персональные сведения');
    expect(serialized).not.toContain('гибридный формат');
  });

  it('refuses forbidden demographic fields and never leaks another candidate resume', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const memories = seedMemory(store, candidateId);

    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: {
        ...draftFor(memories),
        candidate: {
          fullName: 'Mila Example',
          photo: 'forbidden-photo-bytes',
          birthDate: '1990-01-01',
          maritalStatus: 'Forbidden Marital Status',
          religion: 'Forbidden Religion',
        },
      },
    });
    expect(forbidden.statusCode).toBe(422);
    expect(forbidden.json().error).toMatchObject({ code: 'validation_failed' });
    expect(JSON.stringify(forbidden.json())).not.toContain('Forbidden Religion');

    await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: draftFor(memories),
    });

    const otherCandidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(`Bearer ${otherCandidate.accessToken}`),
    });
    expect(isolated.statusCode).toBe(200);
    expect(isolated.json().data.draft).toBeNull();
    expect(JSON.stringify(isolated.json())).not.toContain('Mila Example');
  });

  it('reports approved evidence that stopped being confirmed after the resume was saved', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const memories = seedMemory(store, candidateId);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: draftFor(memories),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.evidenceFreshness).toEqual({ valid: true, stale: [] });

    const revoked = memoryId(memories, 'Сократила цикл поставки на 30% без снижения контроля.');
    store.changeMemory(candidateId, revoked, { action: 'delete' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.evidenceFreshness.valid).toBe(false);
    expect(response.json().data.evidenceFreshness.stale).toEqual([
      { memoryId: revoked, reasons: ['missing'] },
    ]);
    expect(
      response
        .json()
        .data.projection.germanyVariant.unknowns.map((item: { code: string }) => item.code),
    ).toContain('ineligible-evidence');
  });

  it('materializes new manual profile records with candidate message provenance and export projection', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const submitted = manualProfileDraft();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: submitted,
    });

    expect(saved.statusCode).toBe(200);
    const reloaded = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(reloaded.statusCode).toBe(200);
    const { draft, projection } = reloaded.json().data;
    const references = [
      draft.experience[0].chronologyMemoryId,
      draft.education[0].evidenceMemoryId,
      draft.languages[0].evidenceMemoryId,
      draft.projects[0].evidenceMemoryId,
    ];
    expect(references.every((id: string) => !id.startsWith('manual-'))).toBe(true);
    expect(new Set(references).size).toBe(references.length);

    const snapshot = store.getSnapshot(candidateId);
    // Provenance rows are service records: the full snapshot keeps them, the panel feed does not.
    const { messages } = snapshot;
    expect(store.getMessages(candidateId, 'profile')).toEqual([]);
    const expectedText = [
      'Platform Engineer',
      'Example Institute',
      'French',
      'Atlas Reporting Portal',
    ];
    for (const [index, memoryId] of references.entries()) {
      const memory = snapshot.memory.find((item) => item.id === memoryId);
      expect(memory).toMatchObject({
        confidence: 'candidate-confirmed',
        sensitive: false,
        status: 'confirmed',
      });
      expect(memory?.sourceMessageIds).toHaveLength(1);
      const source = messages.find((item) => item.id === memory?.sourceMessageIds[0]);
      expect(source?.role).toBe('user');
      expect(source?.content).toContain(expectedText[index]);
    }

    expect(projection.master.experience[0]?.title).toMatchObject({
      value: 'Platform Engineer',
      memoryId: references[0],
      sourceMessageIds: [
        snapshot.memory.find((item) => item.id === references[0])?.sourceMessageIds[0],
      ],
    });
    expect(projection.master.education[0]?.institution?.value).toBe('Example Institute');
    expect(projection.master.languages[0]?.name?.value).toBe('French');
    expect(projection.master.projects[0]?.description).toMatchObject({
      value: 'Built a reporting portal for account teams.',
      memoryId: references[3],
    });

    const text = formatResumeAsAtsText(projection.master, draft);
    expect(text).toContain('Platform Engineer | Example Systems');
    expect(text).toContain('Example Institute');
    expect(text).toContain('French (B2)');
    expect(text).toContain('Atlas Reporting Portal');
    expect(text).toContain('Built a reporting portal for account teams.');

    const otherCandidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(`Bearer ${otherCandidate.accessToken}`),
    });
    expect(isolated.statusCode).toBe(200);
    expect(isolated.json().data.draft).toBeNull();
    expect(JSON.stringify(isolated.json())).not.toContain('Atlas Reporting Portal');
    expect(store.getSnapshot(otherCandidate.id).memory).toHaveLength(0);
  });

  it('creates a new fact after an explicit row edit and reuses bindings from a stale phase-two payload', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const original = manualProfileDraft();
    const first = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: original,
    });
    expect(first.statusCode).toBe(200);
    const firstRead = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(firstRead.statusCode).toBe(200);
    const originalDraft = firstRead.json().data.draft;
    const originalReferences = {
      experience: originalDraft.experience[0].chronologyMemoryId,
      education: originalDraft.education[0].evidenceMemoryId,
      language: originalDraft.languages[0].evidenceMemoryId,
      project: originalDraft.projects[0].evidenceMemoryId,
    };
    const beforeEditCount = store.getSnapshot(candidateId).memory.length;
    const edited = {
      ...originalDraft,
      education: originalDraft.education.map((entry: { id: string }) =>
        entry.id === 'e-manual-education' ? { ...entry, qualification: 'MSc' } : entry,
      ),
    };

    const second = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: edited,
    });
    expect(second.statusCode).toBe(200);
    const editedRead = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
    });
    expect(editedRead.statusCode).toBe(200);
    const editedDraft = editedRead.json().data.draft;
    expect(editedDraft.education[0].evidenceMemoryId).not.toBe(originalReferences.education);
    expect(store.getSnapshot(candidateId).memory).toHaveLength(beforeEditCount + 1);
    const editedMemory = store
      .getSnapshot(candidateId)
      .memory.find((item) => item.id === editedDraft.education[0].evidenceMemoryId);
    expect(editedMemory?.statement).toContain('MSc');

    const stalePhaseTwoPayload = {
      ...editedDraft,
      experience: editedDraft.experience.map((entry: { id: string }) =>
        entry.id === 'e-manual-role'
          ? { ...entry, chronologyMemoryId: original.experience[0].chronologyMemoryId }
          : entry,
      ),
      education: editedDraft.education.map((entry: { id: string }) =>
        entry.id === 'e-manual-education'
          ? { ...entry, evidenceMemoryId: original.education[0].evidenceMemoryId }
          : entry,
      ),
      languages: editedDraft.languages.map((entry: { id: string }) =>
        entry.id === 'e-manual-language'
          ? { ...entry, evidenceMemoryId: original.languages[0].evidenceMemoryId }
          : entry,
      ),
      projects: editedDraft.projects.map((entry: { id: string }) =>
        entry.id === 'project-manual01' ? { ...entry, evidenceMemoryId: undefined } : entry,
      ),
    };
    const replay = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: stalePhaseTwoPayload,
    });

    expect(replay.statusCode).toBe(200);
    expect(store.getSnapshot(candidateId).memory).toHaveLength(beforeEditCount + 1);
    expect(replay.json().data.draft.experience[0].chronologyMemoryId).toBe(
      originalReferences.experience,
    );
    expect(replay.json().data.draft.education[0].evidenceMemoryId).toBe(
      editedDraft.education[0].evidenceMemoryId,
    );
    expect(replay.json().data.draft.languages[0].evidenceMemoryId).toBe(
      originalReferences.language,
    );
    expect(replay.json().data.draft.projects[0].evidenceMemoryId).toBe(originalReferences.project);
  });

  it('does not confirm unchanged pending project evidence when another collection is saved', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const pendingText = 'Кандидат только рассматривает Reporting Hub как проект.';
    const memories = seedMemory(store, candidateId, [
      ...seededMemories,
      { statement: pendingText, kind: 'fact', confirm: false },
    ]);
    const pendingId = memoryId(memories, pendingText);
    const initial = {
      ...draftFor(memories),
      schemaVersion: 2 as const,
      projects: [
        {
          id: 'pending-project',
          evidenceMemoryId: pendingId,
          name: 'Reporting Hub',
          description: 'A project still under consideration.',
        },
      ],
    };
    const first = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: initial,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.projection.master.projects).toHaveLength(0);

    const withLanguage = {
      ...first.json().data.draft,
      languages: [
        ...first.json().data.draft.languages,
        {
          id: 'e-manual-language-extra',
          evidenceMemoryId: 'manual-language-extra',
          name: 'Italian',
          cefr: 'B1',
        },
      ],
    };
    const second = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: withLanguage,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.projection.master.projects).toHaveLength(0);
    expect(second.json().data.draft.projects[0].evidenceMemoryId).toBe(pendingId);
    expect(
      store.getSnapshot(candidateId).memory.find((item) => item.id === pendingId)?.status,
    ).toBe('proposed');
    expect(
      store
        .getSnapshot(candidateId)
        .memory.some(
          (item) => item.statement.includes('Reporting Hub') && item.status === 'confirmed',
        ),
    ).toBe(false);
  });

  it('rolls back candidate facts when saving the normalized resume fails', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const saveDraft = vi.spyOn(store, 'saveResumeDraft').mockImplementation(() => {
      throw new Error('forced resume write failure');
    });
    let response;
    try {
      response = await app.inject({
        method: 'PUT',
        url: '/api/v1/candidate/resume',
        headers: headers(authorization),
        payload: manualProfileDraft(),
      });
    } finally {
      saveDraft.mockRestore();
    }

    expect(response?.statusCode).toBe(500);
    expect(store.getSnapshot(candidateId).resume?.draft).toBeUndefined();
    expect(
      store
        .getSnapshot(candidateId)
        .memory.some((item) => item.statement.includes('Platform Engineer')),
    ).toBe(false);
  });

  it('keeps the outdated client guard ahead of manual fact creation', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const current = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: manualProfileDraft(),
    });
    expect(current.statusCode).toBe(200);
    const beforeCount = store.getSnapshot(candidateId).memory.length;
    const oldClient = { ...current.json().data.draft, schemaVersion: undefined };

    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: headers(authorization),
      payload: oldClient,
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toMatchObject({ code: 'resume_client_outdated' });
    expect(store.getSnapshot(candidateId).memory).toHaveLength(beforeCount);
  });
});
