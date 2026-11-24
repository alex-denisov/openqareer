import { describe, expect, it } from 'vitest';
import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import {
  buildCandidateFootprintQueryPlan,
  profileLinksOf,
  toPublicFootprintQueryPlan,
} from './candidateFootprintQueryPlan';
import { findingsStillSearched } from './footprintSearchedData';

const draftWith = (links: string[]) => ({
  ...EMPTY_RESUME_DRAFT,
  candidate: { ...EMPTY_RESUME_DRAFT.candidate, fullName: 'Ада', contact: { links } },
});
const planOf = (links: string[]) => buildCandidateFootprintQueryPlan(draftWith(links), { youtube: true });
const finding = (id: string, queries: string[], extra: Partial<CandidateFootprintFinding> = {}) => {
  const receipts = queries.map((query) => ({ method: 'GET', source: 's', query }));
  return { id, receipt: receipts[0], receipts, review: 'unreviewed', ...extra } as CandidateFootprintFinding;
};
const LINK = 'https://www.youtube.com/@ada';

describe('B668: находки убранной ссылки', () => {
  const previous = [
    finding('channel', ['forHandle=@ada']),
    finding('archive', [`url=${LINK}`]),
    finding('nick', ['username=ghost']),
    finding('web', ['"Ада"']),
    finding('both', [`url=${LINK}`, '"Ада"']),
    finding('mine', [`url=${LINK}`], { review: 'confirmed_self' }),
  ];
  const ids = (links: string[]) => findingsStillSearched(previous, planOf(links)).map(({ id }) => id);

  it('ссылки в профиле нет — её находки в новый поиск не переходят; разобранные и найденные иначе остаются', () => {
    expect(ids([])).toEqual(['web', 'both', 'mine']);
  });

  it('ссылка в профиле — находки по ней остаются, даже если она не отмечена', () => {
    expect(ids([LINK])).toEqual(['channel', 'archive', 'web', 'both', 'mine']);
  });

  it('в плане названа ссылка из контактов, как она записана; прочие строки без неё', () => {
    const draft = draftWith(['youtube.com/@ada']);
    const plan = toPublicFootprintQueryPlan(planOf(['youtube.com/@ada']), {}, profileLinksOf(draft));
    const removable = plan.filter((item) => item.profileLink);
    expect(new Set(removable.map((item) => item.profileLink))).toEqual(new Set(['youtube.com/@ada']));
    expect(removable.every((item) => item.kind === 'profile_url')).toBe(true);
  });
});
