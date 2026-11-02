import { describe, expect, it } from 'vitest';
import type { ProposedRole } from './roleProposals';
import { currentMasterVersion, observedCareerRoles, roleAtsRequest, roleKeywordBasis } from './atsBasis';

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

describe('roleKeywordBasis', () => {
  const vp = role('VP of Engineering', observed(['Управление командой']));
  const keywords = ['Kafka', 'Kubernetes', 'Terraform', 'Управление командой'];

  it('uses requirement keywords of the role vacancies with an honest sample label', () => {
    expect(roleKeywordBasis(vp, { keywords, vacanciesCounted: 23 })).toEqual({
      request: { title: 'По роли «VP of Engineering»: 23 вакансии', requirements: keywords },
      roleTitle: 'VP of Engineering',
    });
  });

  it('declines the plural for 1 and 5 vacancies', () => {
    const one = roleKeywordBasis(vp, { keywords, vacanciesCounted: 1 });
    const five = roleKeywordBasis(vp, { keywords, vacanciesCounted: 5 });
    expect(one?.request.title).toBe('По роли «VP of Engineering»: 1 вакансия');
    expect(five?.request.title).toBe('По роли «VP of Engineering»: 5 вакансий');
  });

  it('pads a short list with the role tags without repeating a keyword', () => {
    const basis = roleKeywordBasis(vp, {
      keywords: ['управление командой', 'Kafka'],
      vacanciesCounted: 9,
    });
    expect(basis?.request.requirements).toEqual(['управление командой', 'Kafka']);
  });

  it('falls back to the tags under the plain label when no requirements were extracted', () => {
    const basis = roleKeywordBasis(vp, { keywords: [], vacanciesCounted: 0 });
    expect(basis?.request).toEqual({
      title: 'По роли «VP of Engineering»',
      requirements: ['Управление командой'],
    });
  });

  it('is null when the role has neither keywords nor tags', () => {
    expect(
      roleKeywordBasis(role('VP', observed([])), { keywords: [], vacanciesCounted: 0 }),
    ).toBeNull();
  });
});

describe('observedCareerRoles', () => {
  it('keeps only roles confirmed by the pool, in order', () => {
    const roles = [
      role('CTO', { state: 'too-few', sampleSize: 3 }),
      role('VP', observed([])),
      role('Head', observed(['x'])),
    ];
    expect(observedCareerRoles(roles).map((item) => item.title)).toEqual(['VP', 'Head']);
  });
});
