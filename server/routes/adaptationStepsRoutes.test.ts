import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { AdaptationStep } from '../domain/adaptationSteps';
import type { AdaptationStepsWriter } from '../providers/adaptationStepsWriter';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const plain = 'token-plain';
const STEPS: AdaptationStep[] = [
  { title: 'Познакомиться с командой', description: 'Встречи.', stage: 'days_1_30', category: 'people', basis: 'Руководить командой' },
  { title: 'Разобрать инциденты', description: 'Причины.', stage: 'days_31_60', category: 'delivery', basis: 'Снизить инциденты' },
  { title: 'Запустить релиз', description: 'Цикл.', stage: 'days_61_90', category: 'delivery', basis: 'Снизить инциденты' },
];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(writer?: AdaptationStepsWriter) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-adaptation-steps-'));
  const config = { ...baseConfig, databasePath: join(directory, 'test.sqlite'), cabinetB640Usernames: ['flagged.test'] };
  const candidateStore = new SqliteCandidateStore({ databasePath: config.databasePath, encryptionKey: config.dataEncryptionKey });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`, username, email: null, displayName: null, role: 'candidate', isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([[flagged, principal('flagged.test')], [plain, principal('plain.test')]]);
  const authService: SessionAuth = { ...noSessions, authenticate: (token: string) => sessions.get(token) ?? null };
  const app = await buildApp({
    config, candidateStore, authService, coachProvider: {} as never, serveStatic: false,
    ...(writer ? { adaptationStepsWriter: writer } : {}),
  });
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }), () => candidateStore.close(), () => app.close());
  return app;
}

function call(app: App, method: 'GET' | 'POST', url: string, token?: string, payload?: object) {
  return app.inject({
    method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'http://localhost:3000', 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  });
}

async function workplace(app: App, expectations: string | null) {
  const created = await call(app, 'POST', `${DIARY}/workplaces`, flagged, {
    company: 'Вектор Банк', title: 'Руководитель разработки', startDate: '2026-12-01', ...(expectations ? { expectations } : {}),
  });
  expect(created.statusCode, created.body).toBe(201);
  return `${DIARY}/workplaces/${created.json().data.id}/adaptation-steps`;
}

describe('d01: шаги плана из «Что от вас ждут»', () => {
  it('passes the duty lines of the workplace to the model and returns its steps', async () => {
    const writeSteps = vi.fn().mockResolvedValue(STEPS);
    const app = await setup({ writeSteps });
    const url = await workplace(app, '• Руководить командой\n• Снизить инциденты');
    const response = await call(app, 'POST', url, flagged);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.steps).toEqual(STEPS);
    expect(writeSteps).toHaveBeenCalledWith({ company: 'Вектор Банк', title: 'Руководитель разработки', lines: ['Руководить командой', 'Снизить инциденты'] });
  });

  it('answers null without calling the model when the field is empty', async () => {
    const writeSteps = vi.fn();
    const app = await setup({ writeSteps });
    const response = await call(app, 'POST', await workplace(app, null), flagged);
    expect(response.json().data.steps).toBeNull();
    expect(writeSteps).not.toHaveBeenCalled();
  });

  it('answers null when the model fails, so the client builds the template', async () => {
    const app = await setup({ writeSteps: vi.fn().mockRejectedValue(new Error('down')) });
    const response = await call(app, 'POST', await workplace(app, 'Руководить командой'), flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.steps).toBeNull();
  });

  it('is hidden without the B640 flag and checks the workplace owner', async () => {
    const app = await setup({ writeSteps: vi.fn().mockResolvedValue(STEPS) });
    const url = await workplace(app, 'Руководить командой');
    expect((await call(app, 'POST', url, plain)).statusCode).toBe(404);
    expect((await call(app, 'POST', url)).statusCode).toBe(404);
    const missing = `${DIARY}/workplaces/${randomUUID()}/adaptation-steps`;
    expect((await call(app, 'POST', missing, flagged)).statusCode).toBe(404);
  });
});
