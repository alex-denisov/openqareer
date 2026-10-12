import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

const ORIGIN = { origin: 'http://localhost:3000' };
const URL = '/api/v1/candidate/star-stories';

async function setup() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const owner = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const fact = candidateStore.addManualExperienceFact(
    owner.id,
    'fact-release-cycle',
    'Сократил цикл релиза с 14 до 3 дней.',
  );
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return {
    app,
    ownerId: owner.id,
    ownerAuth: `Bearer ${owner.accessToken}`,
    otherAuth: `Bearer ${other.accessToken}`,
    factId: fact.id,
    candidateStore,
  };
}

function storyInput(sourceFactIds: string[] = ['fact-release-cycle']) {
  return {
    title: 'Сокращение цикла релиза',
    fields: {
      situation: 'Команда выпускала изменения раз в две недели.',
      task: 'Сократить время поставки без ухудшения качества.',
      action: 'Упростил проверку и автоматизировал выкладку.',
      result: 'Сократил цикл релиза с 14 до 3 дней.',
    },
    sourceFactIds,
  };
}

describe('candidate STAR story routes', () => {
  it('limits each candidate to a bounded number of stored stories', async () => {
    const { app, ownerAuth, factId, candidateStore, ownerId } = await setup();
    const createdAt = new Date().toISOString();
    for (let index = 0; index < 100; index += 1) {
      candidateStore.starStoriesRepo.create(
        ownerId,
        `seed-${index}`,
        storyInput([factId]),
        createdAt,
      );
    }

    const rejected = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: storyInput([factId]),
    });
    const list = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: ownerAuth },
    });

    expect(rejected.statusCode).toBe(409);
    expect(list.json().data.stories).toHaveLength(100);
  });

  it('создаёт и читает историю вместе с её фактом-источником', async () => {
    const { app, ownerAuth, factId, candidateStore, ownerId } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: storyInput([factId]),
    });

    expect(created.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: ownerAuth },
    });
    expect(list.json().data.stories).toHaveLength(1);
    expect(list.json().data.stories[0].confidence).toBe('confirmed');
    expect(list.json().data.stories[0].sourceFacts[0].statement).toContain('с 14 до 3 дней');
    expect(candidateStore.exportCandidate(ownerId).starStories).toHaveLength(1);
  });

  it('помечает историю без фактов как неподтверждённую', async () => {
    const { app, ownerAuth } = await setup();
    const unconfirmedStory = storyInput([]);
    unconfirmedStory.fields.result = 'Релиз вышел по плану.';
    const created = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: unconfirmedStory,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.confidence).toBe('unconfirmed');
  });

  it('rejects an unsupported result number and a source from another candidate', async () => {
    const { app, ownerAuth, otherAuth, factId } = await setup();
    const wrongNumber = storyInput([factId]);
    wrongNumber.fields.result = 'Сократил цикл релиза с 14 до 4 дней.';
    const rejectedNumber = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: wrongNumber,
    });
    const rejectedSource = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: otherAuth, ...ORIGIN },
      payload: storyInput([factId]),
    });

    expect(rejectedNumber.statusCode).toBe(422);
    expect(rejectedSource.statusCode).toBe(422);
  });

  it('isolates lists by candidate and applies optimistic updates', async () => {
    const { app, ownerAuth, otherAuth, factId } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: storyInput([factId]),
    });
    const storyId = created.json().data.id as string;
    const updated = await app.inject({
      method: 'PATCH',
      url: `${URL}/${storyId}`,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { ...storyInput([factId]), expectedVersion: 1, title: 'Новый цикл релиза' },
    });
    const stale = await app.inject({
      method: 'PATCH',
      url: `${URL}/${storyId}`,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: { ...storyInput([factId]), expectedVersion: 1 },
    });
    const otherList = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: otherAuth },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.version).toBe(2);
    expect(stale.statusCode).toBe(409);
    expect(otherList.json().data.stories).toEqual([]);
  });

  it('deletes candidate stories with the rest of the candidate account', async () => {
    const { app, ownerAuth, ownerId, candidateStore, factId } = await setup();
    await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: ownerAuth, ...ORIGIN },
      payload: storyInput([factId]),
    });

    expect(candidateStore.deleteCandidate(ownerId)).toBe(true);
    expect(candidateStore.starStoriesRepo.list(ownerId)).toEqual([]);
  });
});
