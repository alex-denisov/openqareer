import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

const ORIGIN = { origin: 'http://localhost:3000' };
const APPLICATIONS_URL = '/api/v1/candidate/applications';
const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};
const paragraph = { questionId: 'q1', field: 'action', text: 'Запустил миграцию', sourceFactId: 'fact-1' };

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
  const ownerAuth = `Bearer ${owner.accessToken}`;
  const created = await app.inject({
    method: 'POST',
    url: APPLICATIONS_URL,
    headers: { authorization: ownerAuth, ...ORIGIN },
    payload: { clusterId: 'cluster-1', stage: 'interview', manualVacancy: vacancy },
  });
  const applicationId = created.json().data.id as string;
  return { app, ownerAuth, otherAuth: `Bearer ${other.accessToken}`, url: `${APPLICATIONS_URL}/${applicationId}/star-prep` };
}

describe('star prep routes', () => {
  it('пустой GET, затем PUT и повторный GET с версией', async () => {
    const { app, ownerAuth, url } = await setup();
    const empty = await app.inject({ method: 'GET', url, headers: { authorization: ownerAuth } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.paragraphs).toEqual([]);

    const put = await app.inject({
      method: 'PUT', url, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { paragraphs: [paragraph] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.version).toBe(1);

    const second = await app.inject({
      method: 'PUT', url, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { paragraphs: [{ ...paragraph, text: 'Правка' }] },
    });
    expect(second.json().data.version).toBe(2);
    const read = await app.inject({ method: 'GET', url, headers: { authorization: ownerAuth } });
    expect(read.json().data.paragraphs[0]).toEqual({ ...paragraph, text: 'Правка' });
  });

  it('отклоняет абзац без факта-источника и не сохраняет его', async () => {
    const { app, ownerAuth, url } = await setup();
    const { sourceFactId: _drop, ...noSource } = paragraph;
    const bad = await app.inject({
      method: 'PUT', url, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { paragraphs: [noSource] },
    });
    expect(bad.statusCode).toBe(422);
    const read = await app.inject({ method: 'GET', url, headers: { authorization: ownerAuth } });
    expect(read.json().data.version).toBe(0);
  });

  it('чужой кандидат получает 404 на чтение и запись', async () => {
    const { app, ownerAuth, otherAuth, url } = await setup();
    await app.inject({
      method: 'PUT', url, headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { paragraphs: [paragraph] },
    });
    const get = await app.inject({ method: 'GET', url, headers: { authorization: otherAuth } });
    expect(get.statusCode).toBe(404);
    const put = await app.inject({
      method: 'PUT', url, headers: { authorization: otherAuth, ...ORIGIN },
      payload: { paragraphs: [paragraph] },
    });
    expect(put.statusCode).toBe(404);
  });
});
