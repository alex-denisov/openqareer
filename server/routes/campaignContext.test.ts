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

describe('readCampaign profile geography (C22)', () => {
  it('infers the profile market from Dubai even when workspace regions are stale', () => {
    const resolution = readCampaign(storeFor(workspace(['us']), 'Dubai · Remote'), 'candidate');

    expect(resolution.regions).toEqual({ value: ['mena'], origin: 'profile' });
  });

  it('maps a Russian profile location to the existing Russia market code', () => {
    expect(readCampaign(storeFor(workspace([]), 'Moscow, Russia'), 'candidate').regions).toEqual({
      value: ['ru'],
      origin: 'profile',
    });
  });

  it('keeps a candidate campaign selection ahead of the inferred profile market', () => {
    const saved = workspace(['us'], {
      roles: [],
      regions: ['eu'],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
    });

    expect(readCampaign(storeFor(saved, 'Dubai'), 'candidate').regions).toEqual({
      value: ['eu'],
      origin: 'explicit',
    });
  });

  it('leaves the stored empty campaign regions untouched while resolving from the profile', () => {
    const saved = workspace([], {
      roles: [],
      regions: [],
      revision: 1,
      updatedAt: '2026-09-26T00:00:00.000Z',
    });

    expect(readCampaign(storeFor(saved, 'Dubai'), 'candidate').regions).toEqual({
      value: ['mena'],
      origin: 'profile',
    });
    expect(saved.campaign?.regions).toEqual([]);
  });

  it('falls back to saved regions when the profile location is blank or unknown', () => {
    const saved = workspace(['ru']);

    expect(readCampaign(storeFor(saved, ''), 'candidate').regions).toEqual({
      value: ['ru'],
      origin: 'profile',
    });
    expect(readCampaign(storeFor(workspace([]), ''), 'candidate').regions).toEqual({
      value: [],
      origin: 'default',
    });
    expect(readCampaign(storeFor(workspace(['us']), 'Atlantis'), 'candidate').regions).toEqual({
      value: ['us'],
      origin: 'profile',
    });
  });
});
