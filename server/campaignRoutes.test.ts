import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CandidateWorkspaceState } from './domain/candidateWorkspace';
import { apps, config, noSessions, stores } from './appTestHarness';

async function createAppWithWorkspace(workspace: CandidateWorkspaceState) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveCandidateWorkspace(candidate.id, workspace);
  const app = await buildApp({
    config,
    coachProvider: { async createTurn() { throw new Error('not_used'); } },
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, candidateStore, candidate };
}

describe('POST /api/v1/candidate/campaign', () => {
  it('persists an explicit remote-only choice with the selected role and regions', async () => {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    candidateStore.saveCandidateWorkspace(candidate.id, {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: 'VP Technology Ops',
      regions: ['ru'],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
    });
    const app = await buildApp({
      config,
      coachProvider: { async createTurn() { throw new Error('not_used'); } },
      candidateStore,
      authService: noSessions,
      serveStatic: false,
    });
    apps.push(app);
    stores.push(candidateStore);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/campaign',
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        origin: 'http://localhost:3000',
      },
      payload: {
        roles: ['VP Technology Ops', 'COO'],
        regions: ['eu', 'mena'],
        remoteOnly: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      roles: { value: ['VP Technology Ops', 'COO'], origin: 'explicit' },
      regions: { value: ['eu', 'mena'], origin: 'explicit' },
      remoteOnly: true,
    });
    expect(candidateStore.getCandidateWorkspace(candidate.id)?.campaign).toMatchObject({
      roles: ['VP Technology Ops', 'COO'],
      regions: ['eu', 'mena'],
      remoteOnly: true,
    });
  });

  it('does not dismiss unselected auto roles when a candidate only changes geography or remote mode', async () => {
    const automaticRoles = [
      {
        id: 'ops.vp', title: 'VP Technology Ops', titleRu: 'VP Tech', functions: ['ops'],
        level: 'vp' as const, kind: 'primary' as const, synonyms: [], evidenceRefs: ['memory:1'], reason: 'Выбрано по фактам.',
      },
      {
        id: 'ops.coo', title: 'COO', titleRu: 'Операционный директор', functions: ['ops'],
        level: 'c-level' as const, kind: 'adjacent' as const, synonyms: [], evidenceRefs: ['memory:1'], reason: 'Смежная роль.',
      },
    ];
    const { app, candidateStore, candidate } = await createAppWithWorkspace({
      resumeText: '',
      resumeSource: 'text',
      targetDirection: 'VP Technology Ops',
      regions: ['ru'],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
      campaign: {
        roles: ['VP Technology Ops'],
        regions: ['ru'],
        revision: 1,
        updatedAt: '2026-09-24T00:00:00.000Z',
        auto: {
          roles: automaticRoles,
          factsDigest: 'digest',
          generatedAt: '2026-09-24T00:00:00.000Z',
          model: 'rules',
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/campaign',
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        origin: 'http://localhost:3000',
      },
      payload: { roles: ['VP Technology Ops'], regions: ['eu'], remoteOnly: true },
    });

    expect(response.statusCode).toBe(200);
    const saved = candidateStore.getCandidateWorkspace(candidate.id)?.campaign;
    expect(saved?.auto?.roles).toHaveLength(2);
    expect(saved?.dismissed ?? []).not.toContain('ops.coo');
  });
});
