import { describe, expect, it } from 'vitest';
import { resumeDraftSchema } from './resumeDraft';
import { buildResumeStudioProjection } from './resumeStudio';

/** Minimal v1 draft, unchanged shape, no `schemaVersion` field at all. */
function v1Draft() {
  return {
    candidate: {
      fullName: 'Mila Example',
      about: 'Runs platform teams.',
      contact: { email: 'mila@example.test', links: [] },
    },
    experience: [
      {
        id: 'role-1',
        chronologyMemoryId: 'memory-role-1',
        title: 'Engineering Manager',
        employer: 'Example GmbH',
        current: true,
        bulletMemoryIds: [],
      },
    ],
    education: [],
    languages: [],
  };
}

/** Full v2 draft exercising every new optional field from architecture §1. */
function v2Draft() {
  return {
    schemaVersion: 2,
    candidate: {
      fullName: 'Mila Example',
      headline: 'VP of Engineering',
      photoMediaId: 'media-photo-1',
      about: 'Runs platform teams.',
      contact: {
        email: 'mila@example.test',
        linkedinUrl: 'https://www.linkedin.com/in/mila-example',
        links: [],
      },
    },
    experience: [
      {
        id: 'role-1',
        chronologyMemoryId: 'memory-role-1',
        title: 'Engineering Manager',
        employer: 'Example GmbH',
        current: true,
        bulletMemoryIds: [],
        employmentType: 'Full-time',
        workplaceType: 'hybrid' as const,
        skills: ['Python', 'Go'],
        employerLogoMediaId: 'media-logo-1',
        employerGroupKey: 'group-example-gmbh',
      },
    ],
    education: [
      {
        id: 'edu-1',
        evidenceMemoryId: 'memory-edu-1',
        institution: 'Example University',
        description: 'Focused on distributed systems.',
      },
    ],
    languages: [],
    certifications: [
      {
        id: 'cert-1',
        name: 'AWS Certified Solutions Architect',
        issuer: 'Amazon',
        issuedAt: '2023-05',
        expiresAt: '2026-05',
        credentialId: 'ABC123',
        url: 'https://www.credly.com/badges/abc123',
      },
    ],
    projects: [
      {
        id: 'proj-1',
        name: 'Internal platform migration',
        startDate: '2022-01',
        endDate: '2022-12',
        current: false,
        description: 'Migrated the platform to Kubernetes.',
        employer: 'Example GmbH',
        url: 'https://example.test/projects/1',
        skills: ['Kubernetes'],
      },
    ],
    achievements: [
      {
        id: 'ach-1',
        kind: 'honor' as const,
        title: 'Engineer of the year',
        issuer: 'Example GmbH',
        date: '2023-01',
        description: 'Recognized for platform reliability work.',
      },
    ],
    sourceSuggestions: {
      openToWork: {
        roles: ['VP of Engineering'],
        locations: ['Berlin'],
        workplaceTypes: ['hybrid' as const],
      },
    },
  };
}

describe('resumeDraftSchema — v2 extension for reading (B265 slice 1)', () => {
  it('accepts a v2 draft with every new optional field', () => {
    const draft = resumeDraftSchema.parse(v2Draft());
    expect(draft.schemaVersion).toBe(2);
    expect(draft.candidate.headline).toBe('VP of Engineering');
    expect(draft.candidate.photoMediaId).toBe('media-photo-1');
    expect(draft.candidate.contact?.linkedinUrl).toBe(
      'https://www.linkedin.com/in/mila-example',
    );
    expect(draft.experience[0]).toMatchObject({
      employmentType: 'Full-time',
      workplaceType: 'hybrid',
      skills: ['Python', 'Go'],
      employerLogoMediaId: 'media-logo-1',
      employerGroupKey: 'group-example-gmbh',
    });
    expect(draft.education[0]?.description).toBe('Focused on distributed systems.');
    expect(draft.certifications?.[0]?.name).toBe('AWS Certified Solutions Architect');
    expect(draft.projects?.[0]?.name).toBe('Internal platform migration');
    expect(draft.achievements?.[0]?.kind).toBe('honor');
    expect(draft.sourceSuggestions?.openToWork?.roles).toEqual(['VP of Engineering']);
  });

  it('accepts a v1 draft unchanged (no schemaVersion)', () => {
    const draft = resumeDraftSchema.parse(v1Draft());
    expect(draft.schemaVersion).toBeUndefined();
    expect(draft.candidate.fullName).toBe('Mila Example');
    expect(draft.candidate.headline).toBeUndefined();
    expect(draft.experience[0]?.employmentType).toBeUndefined();
    expect(draft.certifications).toBeUndefined();
    expect(draft.projects).toBeUndefined();
    expect(draft.achievements).toBeUndefined();
  });

  it('rejects an unknown field even in v2 (strict stays strict)', () => {
    const draft = { ...v2Draft(), foo: 'unexpected' };
    expect(() => resumeDraftSchema.parse(draft)).toThrow();
  });

  it('caps certifications/projects/achievements at their limits', () => {
    const base = v2Draft();
    const oneCertification = base.certifications[0];
    const oneProject = base.projects[0];
    const oneAchievement = base.achievements[0];

    const tooManyCertifications = {
      ...base,
      certifications: Array.from({ length: 51 }, (_, index) => ({
        ...oneCertification,
        id: `cert-${index}`,
      })),
    };
    expect(() => resumeDraftSchema.parse(tooManyCertifications)).toThrow();

    const tooManyProjects = {
      ...base,
      projects: Array.from({ length: 51 }, (_, index) => ({
        ...oneProject,
        id: `proj-${index}`,
      })),
    };
    expect(() => resumeDraftSchema.parse(tooManyProjects)).toThrow();

    const tooManyAchievements = {
      ...base,
      achievements: Array.from({ length: 101 }, (_, index) => ({
        ...oneAchievement,
        id: `ach-${index}`,
      })),
    };
    expect(() => resumeDraftSchema.parse(tooManyAchievements)).toThrow();
  });

  it('drops control characters from long-text fields', () => {
    const withNullByte = {
      ...v2Draft(),
      projects: [
        {
          ...v2Draft().projects[0],
          description: 'Line one\u0000Line two',
        },
      ],
    };
    expect(() => resumeDraftSchema.parse(withNullByte)).toThrow();

    const withEscapeChar = {
      ...v2Draft(),
      achievements: [
        {
          ...v2Draft().achievements[0],
          description: 'Recognized\u001bfor impact',
        },
      ],
    };
    expect(() => resumeDraftSchema.parse(withEscapeChar)).toThrow();
  });

  it('preserves paragraph and bullet formatting in About/description', () => {
    const about = 'First paragraph.\n\nSecond paragraph.\n• Bullet one\n• Bullet two';
    const draft = resumeDraftSchema.parse({
      ...v2Draft(),
      candidate: { ...v2Draft().candidate, about },
    });
    expect(draft.candidate.about).toBe(about);

    const projection = buildResumeStudioProjection({
      ...draft,
      evidence: [],
    });
    expect(projection.master.about).toBe(about);
  });
});
