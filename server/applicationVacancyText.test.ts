import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';
import type { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import {
  APPLICATION_DESCRIPTION_LIMIT,
  snapshotWithDescription,
} from './routes/applicationVacancyText';

/**
 * B635: отклик хранит описание вакансии на момент отклика, чтобы вопросы
 * подготовки к интервью строились по нему, даже когда вакансия ушла из пула.
 */
const snapshot = {
  title: 'Руководитель платформы',
  company: 'Арка Холдинг',
  url: 'https://example.test/jobs/1',
  source: 'src-hh',
};

function engine(description: string | undefined): MultiSourceVacancyEngine {
  const vacancy =
    description === undefined ? undefined : { title: snapshot.title, fullDescription: description };
  return {
    getActiveCluster: () => undefined,
    getVacancy: () => vacancy,
  } as unknown as MultiSourceVacancyEngine;
}

describe('snapshotWithDescription', () => {
  it('adds the pool description to the snapshot', () => {
    const result = snapshotWithDescription(
      engine('Kubernetes и Go, команда платформы.'),
      'cluster-1',
      snapshot,
    );
    expect(result).toEqual({ ...snapshot, description: 'Kubernetes и Go, команда платформы.' });
  });

  it('keeps the snapshot as is when the vacancy is gone or has no text', () => {
    expect(snapshotWithDescription(engine(undefined), 'cluster-1', snapshot)).toEqual(snapshot);
    expect(snapshotWithDescription(engine('   '), 'cluster-1', snapshot)).toEqual(snapshot);
  });

  it('does not overwrite a description the client already sent', () => {
    const sent = { ...snapshot, description: 'Текст из письма рекрутера' };
    expect(snapshotWithDescription(engine('Из пула'), 'cluster-1', sent)).toEqual(sent);
  });

  it('caps a long description', () => {
    const result = snapshotWithDescription(engine('а'.repeat(10_000)), 'cluster-1', snapshot);
    expect(result?.description).toHaveLength(APPLICATION_DESCRIPTION_LIMIT);
  });

  it('leaves a card without a vacancy untouched', () => {
    expect(snapshotWithDescription(engine('Из пула'), null, snapshot)).toEqual(snapshot);
    expect(snapshotWithDescription(engine('Из пула'), 'cluster-1', undefined)).toBeUndefined();
  });
});

describe('POST /applications · B635', () => {
  it('stores the vacancy description and returns it with the card', async () => {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const app = await buildApp({
      config,
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
      multiSourceVacancyEngine: engine('Платформа на Kubernetes, Go и PostgreSQL.'),
    });
    apps.push(app);
    stores.push(candidateStore);
    const headers = {
      authorization: `Bearer ${candidate.accessToken}`,
      origin: 'http://localhost:3000',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/applications',
      headers,
      payload: { clusterId: 'cluster-1', stage: 'applied', manualVacancy: snapshot },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id as string;
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/applications',
      headers,
    });
    const card = read.json().data.find((item: { id: string }) => item.id === id);
    expect(card.vacancy.description).toBe('Платформа на Kubernetes, Go и PostgreSQL.');
  });
});
