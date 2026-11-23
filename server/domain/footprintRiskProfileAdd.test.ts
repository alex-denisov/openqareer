import { describe, expect, it } from 'vitest';
import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import { profileAddRefusal } from '../../shared/footprintChecklist';
import { ruleFor } from './footprintRisk';

function finding(overrides: Partial<CandidateFootprintFinding>): CandidateFootprintFinding {
  return {
    id: 'f1',
    adapter: 'exa',
    kind: 'mention',
    url: 'https://conf.site.test/speakers/sokolova',
    title: 'Доклад на конференции',
    detail: 'Страница доклада',
    match: 'likely_self',
    observedAt: '2026-11-11T09:00:00.000Z',
    receipt: { method: 'exa', source: 'exa', query: 'q' },
    sources: ['exa'],
    receipts: [{ method: 'exa', source: 'exa', query: 'q' }],
    automatedMatch: 'likely_self',
    review: 'unreviewed',
    ...overrides,
  };
}

const BROKERS = [
  'https://aeroleads.com/people/maria-sokolova',
  'https://rocketreach.co/maria-sokolova-email_1',
  'https://contactout.com/maria-sokolova',
  'https://www.signalhire.com/profiles/maria-sokolova',
  'https://app.apollo.io/people/1',
];

describe('B382: базы контактов — всегда риск', () => {
  it.each(BROKERS)('%s — «личные данные», не «полезно», без «В профиль»', (url) => {
    for (const review of ['unreviewed', 'confirmed_self'] as const) {
      const item = finding({ url, review });
      const rule = ruleFor(item);
      expect(rule.category).toBe('personal_data');
      expect(rule.level).not.toBe('useful');
      expect(rule.action.kind).not.toBe('add_to_profile');
      expect(profileAddRefusal(item)).toBe('not_artifact');
    }
  });

  it('обычный сайт базой контактов не считается', () => {
    expect(ruleFor(finding({})).category).toBe('useful_evidence');
  });
});

describe('B382: «В профиль» в сводке ровно там, где его примет сервер', () => {
  const kinds = ['mention', 'publication', 'code', 'talk', 'profile'];
  const reviews = ['unreviewed', 'confirmed_self'] as const;
  const matches = ['likely_self', 'unknown'] as const;
  const urls = ['https://conf.site.test/talk', 'https://aeroleads.com/p/1'];
  const cases = kinds.flatMap((kind) =>
    reviews.flatMap((review) =>
      matches.flatMap((automatedMatch) =>
        urls.map((url) => finding({ kind, review, automatedMatch, url, adapter: 'exa' })),
      ),
    ),
  );

  it.each(cases.map((item) => [item.kind, item.review, item.automatedMatch, item.url, item]))(
    '%s · %s · %s · %s',
    (_kind, _review, _match, _url, item) => {
      const offered = ruleFor(item as CandidateFootprintFinding).action.kind === 'add_to_profile';
      const accepted = profileAddRefusal(item as CandidateFootprintFinding) === null;
      expect(offered).toBe(accepted);
    },
  );

  it('неразобранная находка, которую поиск счёл вашей, — «В профиль»', () => {
    expect(ruleFor(finding({})).action.kind).toBe('add_to_profile');
  });

  it('полезный профиль площадки — только «Это не моё»', () => {
    const rule = ruleFor(finding({ kind: 'profile', review: 'confirmed_self' }));
    expect(rule.level).toBe('useful');
    expect(rule.action).toEqual({ kind: 'not_mine', label: 'Это не моё' });
  });
});
