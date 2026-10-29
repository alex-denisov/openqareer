import { describe, expect, it } from 'vitest';
import { currentVacancyFitProfileValidator, vacancyFitProfileStamp } from './vacancyFitProfileStamp';

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

  it('keeps the stamp when the consultant adds a hypothesis or an open question (B580-r)', () => {
    const fact = { id: 'f1', kind: 'fact', status: 'confirmed', statement: 'Built payments', sourceMessageIds: ['m1'], sensitive: false };
    const hypothesis = { id: 'h1', kind: 'hypothesis', status: 'proposed', statement: 'Может подойти роль CTO', sourceMessageIds: ['m2'], sensitive: false };
    const question = { id: 'q1', kind: 'open-question', status: 'proposed', statement: 'Готов ли к переезду?', sourceMessageIds: ['m2'], sensitive: false };
    const at = (memory: object[]) => vacancyFitProfileStamp({ memory, resume: null } as never, workspace('x'));
    expect(at([fact, hypothesis, question])).toBe(at([fact]));
    expect(at([{ ...fact, statement: 'Built lending' }])).not.toBe(at([fact]));
  });

  it('keeps a paid result when a hypothesis appears while the model answers, not when a fact is revoked (B580-r)', () => {
    const fact = { id: 'f1', kind: 'fact', status: 'confirmed', statement: 'Built payments', sourceMessageIds: ['m1'], sensitive: false };
    const hypothesis = { id: 'h1', kind: 'hypothesis', status: 'proposed', statement: 'Может подойти роль CTO', sourceMessageIds: ['m2'], sensitive: false };
    let memory: object[] = [fact];
    const reader = {
      getSnapshot: () => ({ candidate: { id: 'c1' }, memory, resume: null }),
      getCandidateWorkspace: () => workspace('x'),
    } as never;
    const input = {
      candidateId: 'c1',
      facts: [{ ...fact, candidateId: 'c1' }],
      profileContextHash: vacancyFitProfileStamp({ memory: [fact], resume: null } as never, workspace('x')),
    } as never;
    const validate = currentVacancyFitProfileValidator(reader);
    memory = [fact, hypothesis];
    expect(validate(input)).toBe(true);
    memory = [{ ...fact, status: 'deleted' }, hypothesis];
    expect(validate(input)).toBe(false);
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
