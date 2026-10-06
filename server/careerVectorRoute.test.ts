import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

const ORIGIN = { origin: 'http://localhost:3000' };
const URL = '/api/v1/candidate/career-vector';
const compromises = { grade: 'none', salary: 'none' };

async function setup() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const owner = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, ownerAuth: `Bearer ${owner.accessToken}`, otherAuth: `Bearer ${other.accessToken}` };
}

describe('career vector routes', () => {
  it('пустой GET, PUT считает вектор на сервере, пересмотр поднимает версию', async () => {
    const { app, ownerAuth } = await setup();
    const empty = await app.inject({ method: 'GET', url: URL, headers: { authorization: ownerAuth } });
    expect(empty.json().data).toMatchObject({ version: 0, vector: null, status: 'hypothesis', affectsCampaign: false });

    const first = await app.inject({
      method: 'PUT', url: URL, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { choices: { priority: 'priority_scale' }, antiGoals: [], compromises },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ vector: 'status_scale', version: 1, status: 'hypothesis', affectsCampaign: false });
    expect(first.json().data.rationale.reasons.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: 'PUT', url: URL, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { choices: { priority: 'priority_country' }, antiGoals: [], compromises },
    });
    expect(second.json().data).toMatchObject({ vector: 'relocation', version: 2 });
    const read = await app.inject({ method: 'GET', url: URL, headers: { authorization: ownerAuth } });
    expect(read.json().data.vector).toBe('relocation');
  });

  it('клиентский вектор и неизвестный вариант дают 422, ничего не сохраняется', async () => {
    const { app, ownerAuth } = await setup();
    for (const payload of [
      { choices: {}, antiGoals: [], compromises, vector: 'relocation' },
      { choices: { priority: 'nope' }, antiGoals: [], compromises },
    ]) {
      const bad = await app.inject({ method: 'PUT', url: URL, headers: { authorization: ownerAuth, ...ORIGIN }, payload });
      expect(bad.statusCode).toBe(422);
    }
    const read = await app.inject({ method: 'GET', url: URL, headers: { authorization: ownerAuth } });
    expect(read.json().data.version).toBe(0);
  });

  it('данные кандидатов не пересекаются, без авторизации отказ', async () => {
    const { app, ownerAuth, otherAuth } = await setup();
    await app.inject({
      method: 'PUT', url: URL, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { choices: { priority: 'priority_scale' }, antiGoals: [], compromises },
    });
    const other = await app.inject({ method: 'GET', url: URL, headers: { authorization: otherAuth } });
    expect(other.json().data).toMatchObject({ version: 0, vector: null });
    const anon = await app.inject({ method: 'GET', url: URL });
    expect(anon.statusCode).toBe(401);
  });
});
