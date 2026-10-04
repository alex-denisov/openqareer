import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../domain/resumeDraft';
import {
  buildCandidateFootprintQueryPlan,
  toPublicFootprintQueryPlan,
} from './candidateFootprintQueryPlan';

describe('candidate footprint query plan', () => {
  it('lists only candidate profile identifiers and lets the candidate review masked email use', () => {
    const draft: ResumeDraft = {
      candidate: {
        fullName: 'Maria Petrova',
        photoUrl: 'https://images.example/maria.jpg',
        contact: {
          email: 'maria@example.test',
          phone: '+44 20 7946 0958',
          location: 'London, UK',
          telegram: '@maria_dev',
          linkedinUrl: 'https://www.linkedin.com/in/maria-petrova/',
          links: [
            'https://github.com/maria-dev',
            'https://portfolio.example/about',
            'https://malformed.example/not-profile',
          ],
        },
      },
      experience: [
        {
          id: 'experience-1',
          chronologyMemoryId: 'memory-1',
          title: 'Engineer',
          employer: 'Analytical Engines',
          current: true,
          bulletMemoryIds: [],
        },
        {
          id: 'experience-2',
          chronologyMemoryId: 'memory-2',
          title: 'Consultant',
          employer: 'Difference Company',
          current: false,
          bulletMemoryIds: [],
        },
      ],
      education: [],
      languages: [],
    };

    const internalPlan = buildCandidateFootprintQueryPlan(draft);
    const publicPlan = toPublicFootprintQueryPlan(internalPlan);
    const usernames = internalPlan.filter((item): item is typeof item & { input: { readonly username: string } } =>
      'username' in item.input,
    );
    const email = internalPlan.find((item) => item.adapterId === 'hibp');
    const contextSearches = internalPlan.filter((item) => item.kind === 'work_context');

    expect(usernames.map((item) => `${item.adapterId}:${item.input.username}`)).toContain('sherlock:maria-dev');
    expect(usernames.map((item) => `${item.adapterId}:${item.input.username}`)).toContain('maigret:maria-dev');
    expect(email?.input).toEqual({ email: 'maria@example.test' });
    expect(contextSearches).toHaveLength(3);
    expect(contextSearches.some((item) => item.preview.includes('Analytical Engines'))).toBe(true);
    expect(contextSearches.some((item) => item.preview.includes('Difference Company'))).toBe(true);
    expect(contextSearches.some((item) => item.preview.includes('London, UK'))).toBe(true);
    expect(contextSearches.every((item) => item.adapterId === 'exa')).toBe(true);
    expect(publicPlan.some((item) => item.preview.includes('maria@example.test'))).toBe(false);
    expect(publicPlan.some((item) => item.preview.includes('+44 20 7946 0958'))).toBe(false);
    expect(JSON.stringify(publicPlan)).not.toContain('https://images.example/maria.jpg');
    expect(publicPlan.every((item) => item.selectedByDefault)).toBe(true);
    expect(new Set(publicPlan.map((item) => item.id)).size).toBe(publicPlan.length);
  });

  it('does not create searches when the profile has no identifiers', () => {
    const draft: ResumeDraft = {
      candidate: {},
      experience: [],
      education: [],
      languages: [],
    };

    expect(buildCandidateFootprintQueryPlan(draft)).toEqual([]);
  });
});
