import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from './resumeDraft';
import { mergeReimportedDraft, protectedEditsFromRevisions } from './resumeReimportMerge';

const NO_EDITS = protectedEditsFromRevisions([]);

function role(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    chronologyMemoryId: `${id}-chrono`,
    title: 'Head of IT',
    employer: 'Kaspersky',
    startDate: '2019-03',
    current: true,
    bulletMemoryIds: [`${id}-b1`],
    ...overrides,
  };
}

function draft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return {
    candidate: { headline: 'CIO', about: 'About from LinkedIn' },
    experience: [],
    skills: [],
    education: [],
    languages: [],
    ...overrides,
  } as ResumeDraft;
}

describe('mergeReimportedDraft — a re-import merges, never silently overwrites', () => {
  it('keeps the existing experience id when employer and start date match', () => {
    const existing = draft({ experience: [role('impold-exp-1')] });
    const incoming = draft({ experience: [role('impnew-exp-1')] });
    const merged = mergeReimportedDraft(incoming, existing, NO_EDITS, 'linkedin');
    expect(merged.experience.map((entry) => entry.id)).toEqual(['impold-exp-1']);
  });

  it('B639: keeps the answered real employer name when the place is re-imported', () => {
    const mask = { employer: 'Enterprise Energy IT Services' };
    const answer = { employerRealName: 'Россети Цифра', employerNameMemoryId: 'm-name' };
    const existing = draft({ experience: [role('impold-exp-1', { ...mask, ...answer })] });
    const incoming = draft({ experience: [role('impnew-exp-1', mask)] });
    const merged = mergeReimportedDraft(incoming, existing, NO_EDITS, 'linkedin');
    expect(merged.experience[0]).toMatchObject({ id: 'impold-exp-1', ...answer });
  });

  it('keeps a consultant-edited role title and turns the LinkedIn value into a proposal', () => {
    const existing = draft({ experience: [role('impold-exp-1', { title: 'Chief Information Officer' })] });
    const incoming = draft({ experience: [role('impnew-exp-1', { title: 'Head of IT' })] });
    const edits = protectedEditsFromRevisions([
      { section: 'experience', experienceId: 'impold-exp-1', revertedAt: null },
    ]);
    const merged = mergeReimportedDraft(incoming, existing, edits, 'linkedin');
    expect(merged.experience[0]).toMatchObject({
      id: 'impold-exp-1',
      title: 'Chief Information Officer',
      chronologyMemoryId: 'impold-exp-1-chrono',
      bulletMemoryIds: ['impold-exp-1-b1'],
    });
    expect(merged.sourceSuggestions?.profileUpdates).toEqual([
      { platform: 'linkedin', section: 'experience', entryId: 'impold-exp-1', field: 'title', proposedText: 'Head of IT' },
    ]);
  });

  it('ignores reverted revisions', () => {
    const existing = draft({ experience: [role('impold-exp-1', { title: 'Chief Information Officer' })] });
    const incoming = draft({ experience: [role('impnew-exp-1', { title: 'Head of IT' })] });
    const edits = protectedEditsFromRevisions([
      { section: 'experience', experienceId: 'impold-exp-1', revertedAt: '2026-10-30T00:00:00Z' },
    ]);
    const merged = mergeReimportedDraft(incoming, existing, edits, 'linkedin');
    expect(merged.experience[0].title).toBe('Head of IT');
    expect(merged.sourceSuggestions?.profileUpdates ?? []).toEqual([]);
  });

  it('keeps a consultant-edited role that LinkedIn no longer lists', () => {
    const existing = draft({ experience: [role('impold-exp-1'), role('impold-exp-2', { employer: 'Gone Ltd', startDate: '2010-01' })] });
    const incoming = draft({ experience: [role('impnew-exp-1')] });
    const edits = protectedEditsFromRevisions([
      { section: 'experience', experienceId: 'impold-exp-2', revertedAt: null },
    ]);
    const merged = mergeReimportedDraft(incoming, existing, edits, 'linkedin');
    expect(merged.experience.map((entry) => entry.id)).toEqual(['impold-exp-1', 'impold-exp-2']);
  });

  it('keeps skill ids and confirmation marks, and keeps a confirmed skill LinkedIn does not list', () => {
    const existing = draft({
      skills: [
        { id: 'impold-skill-1', name: 'Docker', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' },
        { id: 'skill-abc', name: 'ITIL', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' },
        { id: 'impold-skill-3', name: 'Excel' },
      ],
    });
    const incoming = draft({
      skills: [
        { id: 'impnew-skill-1', evidenceMemoryId: 'impnew-skill-1-m', name: 'Docker' },
        { id: 'impnew-skill-2', name: 'Kubernetes' },
      ],
    });
    const merged = mergeReimportedDraft(incoming, existing, NO_EDITS, 'linkedin');
    expect(merged.skills).toEqual([
      { id: 'impold-skill-1', evidenceMemoryId: 'impnew-skill-1-m', name: 'Docker', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' },
      { id: 'impnew-skill-2', name: 'Kubernetes' },
      { id: 'skill-abc', name: 'ITIL', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' },
    ]);
  });

  it('keeps an edited about and offers the LinkedIn text as a proposal', () => {
    const existing = draft({ candidate: { headline: 'CIO', about: 'Consultant about' } });
    const incoming = draft({ candidate: { headline: 'CIO', about: 'About from LinkedIn' } });
    const edits = protectedEditsFromRevisions([{ section: 'about', experienceId: null, revertedAt: null }]);
    const merged = mergeReimportedDraft(incoming, existing, edits, 'linkedin');
    expect(merged.candidate.about).toBe('Consultant about');
    expect(merged.sourceSuggestions?.profileUpdates).toEqual([
      { platform: 'linkedin', section: 'about', field: 'about', proposedText: 'About from LinkedIn' },
    ]);
  });

  it('keeps a pending proposal whose target still exists and drops one whose target is gone', () => {
    const existing = draft({
      experience: [role('impold-exp-1')],
      sourceSuggestions: {
        profileUpdates: [
          { platform: 'linkedin', section: 'experience', entryId: 'impold-exp-1', field: 'title', proposedText: 'X' },
          { platform: 'linkedin', section: 'experience', entryId: 'vanished', field: 'title', proposedText: 'Y' },
        ],
      },
    });
    const incoming = draft({ experience: [role('impnew-exp-1')] });
    const merged = mergeReimportedDraft(incoming, existing, NO_EDITS, 'linkedin');
    expect(merged.sourceSuggestions?.profileUpdates).toEqual([
      { platform: 'linkedin', section: 'experience', entryId: 'impold-exp-1', field: 'title', proposedText: 'X' },
    ]);
  });

  it('keeps accepted and declined consultant rewrites so their cards are not offered again', () => {
    const existing = {
      ...draft({ experience: [role('impold-exp-1')] }),
      declinedFactIds: ['fact-1'],
      factRewrites: [{ id: 'rw-1' }],
    } as unknown as ResumeDraft;
    const incoming = draft({ experience: [role('impnew-exp-1')] });
    const merged = mergeReimportedDraft(incoming, existing, NO_EDITS, 'linkedin');
    expect(merged.declinedFactIds).toEqual(['fact-1']);
    expect(merged.factRewrites).toEqual([{ id: 'rw-1' }]);
  });

  it('returns the incoming draft unchanged on a first import', () => {
    const incoming = draft({ experience: [role('impnew-exp-1')] });
    expect(mergeReimportedDraft(incoming, undefined, NO_EDITS, 'linkedin')).toBe(incoming);
  });
});
