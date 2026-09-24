import { describe, expect, it } from 'vitest';
import { parsedResumeToDraft } from './resumeDraftMapper';
import type { ParsedResume } from './resumeParserTypes';

function baseParsed(overrides: Partial<ParsedResume> = {}): ParsedResume {
  return {
    contact: { links: [] },
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    rawText: '',
    ...overrides,
  };
}

describe('parsedResumeToDraft — v2 fields (B265)', () => {
  it('stamps schemaVersion 2 on every draft it produces', () => {
    const draft = parsedResumeToDraft(baseParsed());

    expect(draft.schemaVersion).toBe(2);
  });

  it('carries phone, telegram and linkedinUrl into candidate.contact', () => {
    const draft = parsedResumeToDraft(
      baseParsed({
        contact: {
          email: 'a@b.co',
          phone: '+49 170 0000000',
          telegram: '@candidate',
          location: 'Berlin',
          links: ['https://site.example'],
          linkedinUrl: 'https://linkedin.com/in/candidate',
        },
      }),
    );

    expect(draft.candidate.contact).toEqual({
      email: 'a@b.co',
      phone: '+49 170 0000000',
      telegram: '@candidate',
      location: 'Berlin',
      links: ['https://site.example'],
      linkedinUrl: 'https://linkedin.com/in/candidate',
    });
  });

  it('maps certifications with a stable id per entry', () => {
    const draft = parsedResumeToDraft(
      baseParsed({
        certifications: [
          { name: 'AWS SA', issuer: 'AWS', issuedAt: '2021-05', url: 'https://aws.example/cert' },
        ],
      }),
    );

    expect(draft.certifications).toEqual([
      {
        id: 'cert-1',
        name: 'AWS SA',
        issuer: 'AWS',
        issuedAt: '2021-05',
        expiresAt: undefined,
        credentialId: undefined,
        url: 'https://aws.example/cert',
      },
    ]);
  });

  it('maps projects with a stable id per entry', () => {
    const draft = parsedResumeToDraft(
      baseParsed({
        projects: [{ name: 'Platform migration', description: 'Led the rollout', skills: ['Go'] }],
      }),
    );

    expect(draft.projects).toEqual([
      {
        id: 'project-1',
        name: 'Platform migration',
        startDate: undefined,
        endDate: undefined,
        current: undefined,
        description: 'Led the rollout',
        employer: undefined,
        url: undefined,
        skills: ['Go'],
      },
    ]);
  });

  it('maps achievements keeping the kind discriminator', () => {
    const draft = parsedResumeToDraft(
      baseParsed({
        achievements: [{ kind: 'publication', title: 'Scaling paper', issuer: 'ACM' }],
      }),
    );

    expect(draft.achievements).toEqual([
      {
        id: 'achievement-1',
        kind: 'publication',
        title: 'Scaling paper',
        issuer: 'ACM',
        role: undefined,
        date: undefined,
        endDate: undefined,
        description: undefined,
        url: undefined,
      },
    ]);
  });

  it('moves openToWork into sourceSuggestions, never into a live preference field', () => {
    const draft = parsedResumeToDraft(
      baseParsed({
        openToWork: {
          roles: ['VP Engineering'],
          locations: ['Berlin'],
          workplaceTypes: ['remote'],
        },
      }),
    );

    expect(draft.sourceSuggestions).toEqual({
      openToWork: {
        roles: ['VP Engineering'],
        locations: ['Berlin'],
        workplaceTypes: ['remote'],
      },
    });
    expect((draft as unknown as Record<string, unknown>).openToWork).toBeUndefined();
  });

  it('omits sourceSuggestions entirely when the source carried no open-to-work signal', () => {
    const draft = parsedResumeToDraft(baseParsed());

    expect(draft.sourceSuggestions).toBeUndefined();
  });

  it('omits certifications/projects/achievements when the source has none', () => {
    const draft = parsedResumeToDraft(baseParsed());

    expect(draft.certifications).toBeUndefined();
    expect(draft.projects).toBeUndefined();
    expect(draft.achievements).toBeUndefined();
  });
});
