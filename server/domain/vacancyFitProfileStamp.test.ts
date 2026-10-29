import { describe, expect, it } from 'vitest';
import { vacancyFitProfileStamp } from './vacancyFitProfileStamp';

const snapshot = { memory: [{ id: 'f1', statement: 'Built payments' }], resume: null } as never;
function workspace(visit: string, roles = ['Head of Engineering']) {
  return { lastVisitedAt: visit, previousVisitedAt: visit, campaign: { roles } } as never;
}

describe('vacancyFitProfileStamp', () => {
  it('stays the same across visits to «Сегодня», so cached fits are not recomputed', () => {
    expect(vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z'))).toBe(
      vacancyFitProfileStamp(snapshot, workspace('2026-10-20T02:00:00.000Z')),
    );
  });

  it('changes when what the match depends on changes', () => {
    expect(vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z'))).not.toBe(
      vacancyFitProfileStamp(snapshot, workspace('2026-10-20T01:00:00.000Z', ['CTO'])),
    );
  });

  describe('only what the percent compares (B580)', () => {
    const draft = {
      candidate: {
        fullName: 'Алексей',
        headline: 'Head of Platform',
        about: 'О себе',
        contact: {
          email: 'a@example.test',
          phone: '+7 900',
          location: 'Москва',
          links: ['https://a.test'],
        },
      },
      targetRole: 'Head of Platform',
      experience: [{ title: 'Head of Platform', company: 'Acme' }],
      skills: [{ name: 'Kubernetes' }],
      languages: [{ name: 'English', level: 'C1' }],
      education: [],
    };
    const base = {
      lastVisitedAt: 'x',
      currentSituation: 'ищу',
      constraints: '',
      linkedinUrl: 'https://linkedin.test/a',
      campaign: { roles: ['CTO'], regions: [], revision: 1, updatedAt: 'x' },
    };
    const stamp = (resume: object, workspaceState: object = base) =>
      vacancyFitProfileStamp(
        { memory: [{ id: 'f1', statement: 'Built payments' }], resume: { draft: resume } } as never,
        workspaceState as never,
      );
    const candidate = (patch: object) => ({
      ...draft,
      candidate: { ...draft.candidate, ...patch },
    });

    it('keeps the stamp when «о себе», contacts, photo or the situation text change', () => {
      const before = stamp(draft);
      expect(
        stamp(candidate({ about: 'Новый текст', aboutOrigin: { kind: 'candidate', at: 'x' } })),
      ).toBe(before);
      expect(
        stamp(
          candidate({
            contact: {
              ...draft.candidate.contact,
              email: 'b@example.test',
              phone: '+7 911',
              links: [],
            },
          }),
        ),
      ).toBe(before);
      expect(stamp(candidate({ photoUrl: 'https://p.test/1.jpg', fullName: 'Алексей Д.' }))).toBe(
        before,
      );
      expect(
        stamp(draft, {
          ...base,
          currentSituation: 'другое',
          linkedinUrl: 'https://linkedin.test/b',
          campaign: { ...base.campaign, updatedAt: 'y', revision: 2 },
        }),
      ).toBe(before);
    });

    it('changes the stamp when skills, experience, titles, languages or the city change', () => {
      const before = stamp(draft);
      expect(stamp({ ...draft, skills: [{ name: 'Go' }] })).not.toBe(before);
      expect(stamp({ ...draft, experience: [{ title: 'CTO', company: 'Acme' }] })).not.toBe(before);
      expect(stamp(candidate({ headline: 'CTO' }))).not.toBe(before);
      expect(stamp({ ...draft, languages: [] })).not.toBe(before);
      expect(
        stamp(candidate({ contact: { ...draft.candidate.contact, location: 'Берлин' } })),
      ).not.toBe(before);
      expect(
        stamp(draft, { ...base, campaign: { ...base.campaign, roles: ['VP Engineering'] } }),
      ).not.toBe(before);
    });
  });
});
