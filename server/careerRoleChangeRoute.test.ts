import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { careerRoleId } from '../shared/roleProposals';
import { apps, config, noSessions, stores } from './appTestHarness';

async function setup() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveCandidateWorkspace(candidate.id, {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: 'VP of Engineering',
    regions: ['ru'],
    currentSituation: '',
    constraints: '',
    urgency: 'active',
    campaign: {
      roles: ['VP of Engineering'],
      regions: [],
      revision: 3,
      updatedAt: '2026-10-06T00:00:00Z',
      careerRoles: [{ id: careerRoleId('Head of Product'), title: 'Head of Product' }],
    },
  });
  const app = await buildApp({
    config,
    coachProvider: {
      async createTurn() {
        throw new Error('not_used');
      },
    },
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  const change = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-roles',
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        origin: 'http://localhost:3000',
      },
      payload: payload as Record<string, unknown>,
    });
  return { change, candidateStore, candidate };
}

describe('POST /api/v1/candidate/career-roles (26.10)', () => {
  it('добавленная роль попадает в подбор, убранная — уходит из него', async () => {
    const { change } = await setup();

    const added = await change({ action: 'add', title: 'CTO' });
    expect(added.statusCode).toBe(200);
    expect(added.json().data.roles.value).toEqual([
      'VP of Engineering',
      'CTO',
      'Head of Product',
    ]);

    const removed = await change({ action: 'remove', title: 'Head of Product' });
    expect(removed.json().data.roles.value).toEqual(['VP of Engineering', 'CTO']);

    const removedWizard = await change({ action: 'remove', title: 'VP of Engineering' });
    expect(removedWizard.json().data.roles.value).toEqual(['CTO']);
  });

  it('повторное добавление снимает прежнее отклонение роли', async () => {
    const { change, candidateStore, candidate } = await setup();
    await change({ action: 'remove', title: 'Head of Product' });
    const readded = await change({ action: 'add', title: 'Head of Product' });
    expect(readded.json().data.roles.value).toContain('Head of Product');
    expect(
      candidateStore
        .getConsultantRejections(candidate.id)
        .some((rejection) => rejection.proposalKey.endsWith(careerRoleId('Head of Product'))),
    ).toBe(false);
  });

  it('отвечает 400 на пустое название', async () => {
    const { change } = await setup();
    expect((await change({ action: 'add', title: ' ' })).statusCode).toBe(400);
  });
});

describe('GET /api/v1/coach/proposals/career-rejections (26.10)', () => {
  it('возвращает только отказы от изменений «Карьеры»', async () => {
    const { candidateStore, candidate } = await setup();
    candidateStore.rejectConsultantProposal(candidate.id, 'career.conditions.update:abc', 'Не сейчас');
    candidateStore.rejectConsultantProposal(candidate.id, 'headline:xyz', 'нет');
    const app = apps.at(-1)!;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/coach/proposals/career-rejections',
      headers: { authorization: `Bearer ${candidate.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(['career.conditions.update:abc']);
  });
});
