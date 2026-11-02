import { describe, expect, it } from 'vitest';
import type { ProposedRole } from './roleProposals';
import { currentMasterVersion, roleAtsRequest } from './atsBasis';

function role(title: string, confirmation: ProposedRole['confirmation']): ProposedRole {
  return {
    id: title,
    title,
    origin: 'market',
    reason: null,
    evidenceRefs: [],
    confirmation,
    family: null,
  };
}

const observed = (repeatedRequirements: string[]): ProposedRole['confirmation'] => ({
  state: 'observed',
  sampleSize: 40,
  observedFrom: '2026-09-01',
  observedTo: '2026-10-01',
  sources: [{ source: 'hh', count: 40 }],
  repeatedRequirements,
  matchedRequirements: 0,
});

describe('roleAtsRequest (макет 2 «ATS: нет избранных вакансий»)', () => {
  it('takes the first observed role with repeated requirements and names it', () => {
    expect(
      roleAtsRequest([
        role('CTO', { state: 'too-few', sampleSize: 3 }),
        role('Head of Engineering', observed(['Kafka', 'Kubernetes'])),
      ]),
    ).toEqual({
      request: { title: 'По роли «Head of Engineering»', requirements: ['Kafka', 'Kubernetes'] },
      roleTitle: 'Head of Engineering',
    });
  });

  it('returns null when no role has observed requirements', () => {
    expect(
      roleAtsRequest([role('CTO', { state: 'not-found' }), role('VP', observed([]))]),
    ).toBeNull();
  });
});

describe('currentMasterVersion', () => {
  const version = (id: string, sourceMasterRevision: string) => ({ id, sourceMasterRevision });

  it('takes the first version built from the current master revision', () => {
    expect(
      currentMasterVersion(
        [version('old', 'r1'), version('newest-current', 'r2'), version('older-current', 'r2')],
        'r2',
      ),
    ).toEqual(version('newest-current', 'r2'));
  });

  it('returns null when every version is built from an older master', () => {
    expect(currentMasterVersion([version('old', 'r1')], 'r2')).toBeNull();
  });
});
