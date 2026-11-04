import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type { ResumeStructurer } from './providers/resumeStructurer';
import { parseResumeContent, type ParsedResume } from '../src/features/workspace/resumeParser';

const config = {
  host: '127.0.0.1',
  port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 5),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
} as unknown as ServerConfig;

const DOCUMENT = [
  'Иван Тестов',
  'Опыт работы',
  'ООО «Финтех Платформа», Москва — Senior Software Engineer',
  'Март 2021 — настоящее время',
  'Веду платформенную команду из шести инженеров.',
  'Навыки',
  'TypeScript, React, Node.js, PostgreSQL',
].join('\n');

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp(resumeStructurer: ResumeStructurer) {
  const store = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: config.dataEncryptionKey });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: {} as unknown as CoachProvider,
    candidateStore: store,
    authService: { authenticate: () => null } as unknown as SessionAuth,
    serveStatic: false,
    resumeStructurer,
  });
  apps.push(app);
  stores.push(store);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

type App = Awaited<ReturnType<typeof createApp>>['app'];

const read = (app: App, authorization: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization } });

const importDocument = (app: App, authorization: string, text = DOCUMENT) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/candidate/resume/import',
    headers: { authorization },
    payload: { text, source: 'pdf', fileName: 'cv.pdf' },
  });

async function settled(app: App, authorization: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { data } = (await read(app, authorization, '/api/v1/candidate/resume/import/refinement')).json();
    if (data.status !== 'pending') return data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('refinement did not settle');
}

function modelReading(): ParsedResume {
  const rules = parseResumeContent(DOCUMENT);
  return {
    ...rules,
    experience: [{ ...rules.experience[0]!, employer: 'Прочитала модель' }],
    rawText: DOCUMENT,
  };
}

const heldStructurer = () => {
  let release: (value: ParsedResume | null) => void = () => undefined;
  const structurer: ResumeStructurer = {
    provenance: { model: 'test:model', promptRevision: 'v1' },
    structure: () => new Promise((resolve) => {
      release = resolve;
    }),
  };
  return { structurer, release: (value: ParsedResume | null) => release(value) };
};

describe('resume import answers with the rules, the model refines behind it (04.11)', () => {
  it('answers before the model does, then stores the model reading without doubling facts', async () => {
    const held = heldStructurer();
    const { app, authorization } = await createApp(held.structurer);
    const response = await importDocument(app, authorization);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ structuredBy: 'rules', refinement: 'pending' });
    expect((await read(app, authorization, '/api/v1/candidate/resume/import/refinement')).json().data.status).toBe('pending');

    held.release(modelReading());
    const refined = await settled(app, authorization);
    expect(refined.status).toBe('refined');
    expect(refined.parsed.experience[0].employer).toBe('Прочитала модель');
    const resume = (await read(app, authorization, '/api/v1/candidate/resume')).json().data;
    expect(resume.draft.experience[0].employer).toBe('Прочитала модель');
    expect(resume.reader).toMatchObject({ method: 'model', model: 'test:model' });
    const { memory } = (await read(app, authorization, '/api/v1/candidate/me')).json().data;
    expect(memory).toHaveLength(refined.factCount);
  });

  it('keeps the rules reading when the model has no answer', async () => {
    const held = heldStructurer();
    const { app, authorization } = await createApp(held.structurer);
    await importDocument(app, authorization);
    held.release(null);
    expect((await settled(app, authorization)).status).toBe('kept');
    expect((await read(app, authorization, '/api/v1/candidate/resume')).json().data.reader.method).toBe('rules');
  });

  it('a candidate edit during the model read wins', async () => {
    const held = heldStructurer();
    const { app, authorization } = await createApp(held.structurer);
    await importDocument(app, authorization);
    const before = (await read(app, authorization, '/api/v1/candidate/resume')).json().data.draft;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
      payload: before,
    });
    expect(saved.statusCode).toBe(200);
    held.release(modelReading());
    expect((await settled(app, authorization)).status).toBe('kept');
    const after = (await read(app, authorization, '/api/v1/candidate/resume')).json().data.draft;
    expect(after.experience[0].employer).not.toBe('Прочитала модель');
  });

  it('a newer import cancels the refinement of the older one', async () => {
    const pending: Array<(value: ParsedResume | null) => void> = [];
    const { app, authorization } = await createApp({
      structure: () => new Promise((resolve) => {
        pending.push(resolve);
      }),
    });
    await importDocument(app, authorization);
    await importDocument(app, authorization, `${DOCUMENT}\nЕщё строка опыта`);
    pending[0]!(modelReading());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const view = (await read(app, authorization, '/api/v1/candidate/resume/import/refinement')).json().data;
    expect(view.status).toBe('pending');
  });

  it('still waits for the model when the rules found nothing', async () => {
    let called = 0;
    const { app, authorization } = await createApp({
      structure: async () => {
        called += 1;
        return null;
      },
    });
    const response = await importDocument(app, authorization, 'просто строка без фактов');
    expect(called).toBe(1);
    expect(response.statusCode).toBe(422);
  });
});
