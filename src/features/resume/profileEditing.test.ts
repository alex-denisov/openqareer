import { describe, expect, it } from 'vitest';
import { openToWorkDismissalKey, patchTopcard } from './profileEditing';
import type { ResumeDraft } from './resumeTypes';

const base: ResumeDraft = {
  candidate: {
    fullName: 'Марина Соколова',
    headline: 'VP of Engineering',
    photoUrl: 'https://example.com/photo.jpg',
    contact: {
      email: 'm@example.com',
      phone: '+49 30 555 0142',
      telegram: '@marina',
      location: 'Берлин, Германия',
      linkedinUrl: 'https://linkedin.com/in/marina',
    },
  },
  experience: [],
  education: [],
  languages: [],
};

describe('patchTopcard', () => {
  it('changes only the given fields', () => {
    const next = patchTopcard(base, { fullName: 'Марина С.' });
    expect(next.candidate.fullName).toBe('Марина С.');
    expect(next.candidate.headline).toBe('VP of Engineering');
  });

  it('never drops headline, photo, telegram or linkedinUrl (not part of the edit form)', () => {
    const next = patchTopcard(base, { location: 'Мюнхен, Германия' });
    expect(next.candidate.headline).toBe('VP of Engineering');
    expect(next.candidate.photoUrl).toBe('https://example.com/photo.jpg');
    expect(next.candidate.contact?.telegram).toBe('@marina');
    expect(next.candidate.contact?.linkedinUrl).toBe('https://linkedin.com/in/marina');
    expect(next.candidate.contact?.location).toBe('Мюнхен, Германия');
  });

  it('does not mutate the original draft', () => {
    patchTopcard(base, { fullName: 'Changed' });
    expect(base.candidate.fullName).toBe('Марина Соколова');
  });
});

describe('openToWorkDismissalKey', () => {
  it('is undefined when there is no proposal', () => {
    expect(openToWorkDismissalKey('cand-1', undefined)).toBeUndefined();
  });

  it('changes when the proposal changes, so a fresh import clears any prior dismissal', () => {
    const first = openToWorkDismissalKey('cand-1', {
      openToWork: { roles: ['VP'], locations: ['Berlin'], workplaceTypes: ['remote'] },
    });
    const second = openToWorkDismissalKey('cand-1', {
      openToWork: { roles: ['VP', 'Director'], locations: ['Berlin'], workplaceTypes: ['remote'] },
    });
    expect(first).not.toEqual(second);
  });

  it('is stable for the same candidate and proposal', () => {
    const suggestion = {
      openToWork: { roles: ['VP'], locations: ['Berlin'], workplaceTypes: ['remote'] as const },
    };
    expect(openToWorkDismissalKey('cand-1', suggestion)).toEqual(
      openToWorkDismissalKey('cand-1', suggestion),
    );
  });
});
