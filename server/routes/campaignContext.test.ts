import { describe, expect, it } from 'vitest';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { RouteDeps } from './deps';
import { readCampaign } from './campaignContext';

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
