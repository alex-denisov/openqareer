import type { InjectOptions, LightMyRequestResponse } from 'fastify';
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
const select = { action: 'select', contact: { name: 'Анна', role: 'Руководитель аналитики' } };

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
  const id = created.json().data.id as string;
  const url = `${APPLICATIONS_URL}/${id}/referral-track`;
  const call = async (
    method: 'GET' | 'PUT',
    auth: string,
    payload?: InjectOptions['payload'],
  ): Promise<LightMyRequestResponse> =>
    (await app.inject({
      method,
      url,
      headers: { authorization: auth, ...ORIGIN },
      payload,
    })) as unknown as LightMyRequestResponse;
  const put = (payload: InjectOptions['payload'], auth = ownerAuth) => call('PUT', auth, payload);
  const get = (auth = ownerAuth) => call('GET', auth);
  return { put, get, otherAuth: `Bearer ${other.accessToken}` };
}

describe('referral track routes', () => {
  it('пустой GET, затем весь путь до ответа только действиями кандидата', async () => {
    const { put, get } = await setup();
    expect((await get()).json().data.track).toBeNull();
    const selected = await put(select);
    expect(selected.statusCode).toBe(200);
    expect(selected.json().data.track.status).toBe('selected');
    const pitch = await put({ action: 'draft_pitch', pitch: 'Здравствуйте! Мы не знакомы.' });
    expect(pitch.json().data.track.status).toBe('pitch_ready');
    const sent = await put({ action: 'candidate_sent_request' });
    expect(sent.json().data.track.status).toBe('request_sent');
    expect(sent.json().data.track.sentByCandidateAt).not.toBeNull();
    const reply = await put({ action: 'record_reply', outcome: 'positive' });
    expect(reply.json().data.track.status).toBe('replied_positive');
    const read = await get();
    expect(read.json().data.contact).toEqual({ name: 'Анна', role: 'Руководитель аналитики', profileUrl: null });
    expect(read.json().data.version).toBe(4);
  });

  it('недопустимый переход даёт 409 и ничего не меняет', async () => {
    const { put, get } = await setup();
    await put(select);
    const skip = await put({ action: 'candidate_sent_request' });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.code).toBe('referral_transition_not_allowed');
    const early = await put({ action: 'record_reply', outcome: 'positive' });
    expect(early.statusCode).toBe(409);
    const read = await get();
    expect(read.json().data.track.status).toBe('selected');
    expect(read.json().data.version).toBe(1);
  });

  it('действие без выбранного контакта и питч с давлением отклоняются', async () => {
    const { put, get } = await setup();
    expect((await put({ action: 'draft_pitch', pitch: 'Привет' })).statusCode).toBe(409);
    await put(select);
    const pressure = await put({ action: 'draft_pitch', pitch: 'Помогите срочно, иначе я пропал' });
    expect(pressure.statusCode).toBe(422);
    expect((await get()).json().data.track.status).toBe('selected');
  });

  it('чужой кандидат получает 404 на чтение и запись', async () => {
    const { put, get, otherAuth } = await setup();
    await put(select);
    expect((await get(otherAuth)).statusCode).toBe(404);
    expect((await put(select, otherAuth)).statusCode).toBe(404);
  });
});
