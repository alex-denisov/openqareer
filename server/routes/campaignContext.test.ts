import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from './deps';
import { campaignMeta, readCampaign } from './campaignContext';

function workspace(
  regions: readonly ('ru' | 'cis' | 'us' | 'eu' | 'mena' | 'apac' | 'latam')[],
  campaign?: CandidateWorkspaceState['campaign'],
): CandidateWorkspaceState {
  return {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: '',
    regions: [...regions],
    currentSituation: '',
    constraints: '',
    urgency: 'exploring',
    ...(campaign ? { campaign } : {}),
  };
}

function storeFor(saved: CandidateWorkspaceState, location?: string): RouteDeps['candidateStore'] {
  return {
    getCandidateWorkspace: () => saved,
    getSnapshot: () => ({
      memory: [],
      resume: location ? { draft: { candidate: { contact: { location } } } } : null,
    }),
  } as unknown as RouteDeps['candidateStore'];
}

describe('readCampaign profile geography (C22 / C63)', () => {
  it('infers suggestedRegions from Dubai while keeping campaign regions unrestricted by default', () => {
    const resolution = readCampaign(storeFor(workspace(['us']), 'Dubai · Remote'), 'candidate');

    expect(resolution.regions).toEqual({ value: [], origin: 'default' });
    expect(resolution.suggestedRegions).toEqual(['mena']);
  });

  it('maps a Russian profile location to suggestedRegions without auto-applying to campaign', () => {
    const resolution = readCampaign(storeFor(workspace([]), 'Moscow, Russia'), 'candidate');
    expect(resolution.regions).toEqual({
      value: [],
      origin: 'default',
    });
    expect(resolution.suggestedRegions).toEqual(['ru']);
  });

  it('keeps a candidate campaign selection ahead of the inferred profile market', () => {
    const saved = workspace(['us'], {
      roles: [],
      regions: ['eu'],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
    });

    const resolution = readCampaign(storeFor(saved, 'Dubai'), 'candidate');
    expect(resolution.regions).toEqual({
      value: ['eu'],
      origin: 'explicit',
    });
    expect(resolution.suggestedRegions).toEqual(['mena']);
  });

  it('leaves the stored empty campaign regions untouched and explicit while suggesting profile region', () => {
    const saved = workspace([], {
      roles: [],
      regions: [],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
    });

    const resolution = readCampaign(storeFor(saved, 'Dubai'), 'candidate');
    expect(resolution.regions).toEqual({
      value: [],
      origin: 'explicit',
    });
    expect(resolution.suggestedRegions).toEqual(['mena']);
    expect(saved.campaign?.regions).toEqual([]);
  });

  it('falls back to workspace regions as suggestions when profile location is blank or unknown', () => {
    const saved = workspace(['ru']);

    const res1 = readCampaign(storeFor(saved, ''), 'candidate');
    expect(res1.regions).toEqual({
      value: [],
      origin: 'default',
    });
    expect(res1.suggestedRegions).toEqual(['ru']);

    const res2 = readCampaign(storeFor(workspace([]), ''), 'candidate');
    expect(res2.regions).toEqual({
      value: [],
      origin: 'default',
    });
    expect(res2.suggestedRegions).toEqual([]);

    const res3 = readCampaign(storeFor(workspace(['us']), 'Atlantis'), 'candidate');
    expect(res3.regions).toEqual({
      value: [],
      origin: 'default',
    });
    expect(res3.suggestedRegions).toEqual(['us']);
  });

  it("B748: titlesRu carries this candidate's checked translations, ontology first", () => {
    const saved = workspace([], {
      roles: ['Head of Quantum Ops'],
      regions: [],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
      careerRoles: [
        {
          id: 'head-of-quantum-ops',
          title: 'Head of Quantum Ops',
          titleRu: 'Руководитель квантовых операций',
        },
        { id: 'coo', title: 'Chief Operating Officer', titleRu: 'Директор по операциям' },
      ],
    });
    const meta = campaignMeta(readCampaign(storeFor(saved), 'candidate'));
    expect(meta.titlesRu['Head of Quantum Ops']).toBe('Руководитель квантовых операций');
    expect(meta.titlesRu['Chief Operating Officer']).toBe('Операционный директор (COO)');
  });

  it('returns model role level, reason and statements cited by evidenceRefs', () => {
    const saved = workspace([], {
      roles: [],
      regions: [],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
      auto: {
        roles: [
          {
            id: 'ops.vp',
            title: 'VP of Operations',
            titleRu: 'Вице-президент по операциям',
            functions: ['ops'],
            level: 'vp',
            kind: 'primary',
            synonyms: [],
            evidenceRefs: ['memory:fact-1'],
            reason: 'Опыт управления региональными операциями.',
          },
        ],
        factsDigest: 'digest',
        generatedAt: '2026-09-26T00:00:00.000Z',
        model: 'test-model',
      },
    });
    const store = {
      getCandidateWorkspace: () => saved,
      getSnapshot: () => ({
        memory: [
          {
            id: 'fact-1',
            domain: 'role-evidence',
            kind: 'scope',
            statement: 'Руководил операциями в четырёх регионах.',
            status: 'confirmed',
          },
        ],
        resume: null,
      }),
    } as unknown as RouteDeps['candidateStore'];

    expect(readCampaign(store, 'candidate').autoRoles[0]).toMatchObject({
      title: 'VP of Operations',
      titleRu: 'Вице-президент по операциям',
      level: 'vp',
      reason: 'Опыт управления региональными операциями.',
      evidenceRefs: ['memory:fact-1'],
      evidence: ['Руководил операциями в четырёх регионах.'],
    });
  });
});

/** CPO 26.10: фильтр «Зарплата» начинается с валюты условий, поэтому она уходит в ответ. */
describe('campaignMeta salary currency', () => {
  it('passes the candidate conditions currency to the client', () => {
    const store = {
      ...storeFor(workspace([])),
      decisionProfileRepo: { get: () => ({ salaryFloor: 600_000, salaryCurrency: 'RUB' }) },
    } as unknown as RouteDeps['candidateStore'];
    const meta = campaignMeta(readCampaign(store, 'c1'));
    expect(meta.salaryCurrency).toBe('RUB');
  });
});

/** B737: роль поиска — ключ на английском; кандидату её показывают по-русски. */
describe('campaignMeta titlesRu', () => {
  it('gives the Russian name of each search role that has one', () => {
    const store = storeFor(
      workspace([], {
        roles: ['Chief Operating Officer', 'Директор по чудесам'],
        regions: [],
        revision: 1,
        updatedAt: '2026-11-22T00:00:00.000Z',
      } as CandidateWorkspaceState['campaign']),
    );
    const meta = campaignMeta(readCampaign(store, 'c1'));
    expect(meta.roles.value).toEqual(['Chief Operating Officer', 'Директор по чудесам']);
    expect(meta.titlesRu).toEqual({ 'Chief Operating Officer': 'Операционный директор (COO)' });
  });
});
