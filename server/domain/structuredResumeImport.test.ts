import { describe, expect, it } from 'vitest';
import { carriesProfileSubstance } from './resumeImport';
import {
  keepFilledSections,
  attachResumeMedia,
  collectMediaRequests,
  linkedinProfileV2ToParsedResume,
  planStructuredResumeImport,
} from './structuredResumeImport';
import type { LinkedInProfileV2 } from '../../shared/linkedinProfileV2';
import type { DownloadedMedia } from './candidateMedia';

function baseProfile(overrides: Partial<LinkedInProfileV2> = {}): LinkedInProfileV2 {
  return {
    fullName: 'Jordan Rivers',
    headline: 'VP of Technology & Operations',
    contact: { links: [] },
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    ...overrides,
  } as LinkedInProfileV2;
}

describe('planStructuredResumeImport — mapping table (QA spec slice 3 #14)', () => {
  it('carries headline into the draft candidate', () => {
    const plan = planStructuredResumeImport(baseProfile(), { idPrefix: 'imp1234567' });
    expect(plan.draft.candidate.headline).toBe('VP of Technology & Operations');
    expect(plan.draft.schemaVersion).toBe(2);
  });

  it('carries employmentType/workplaceType/skills per role', () => {
    const profile = baseProfile({
      experience: [
        {
          title: 'Engineer',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
          employmentType: 'Full-time',
          workplaceType: 'remote',
          skills: ['Python', 'Go'],
        },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.experience[0]).toMatchObject({
      employmentType: 'Full-time',
      workplaceType: 'remote',
      skills: ['Python', 'Go'],
    });
  });

  it('groups multiple roles under one employer via employerGroupKey', () => {
    const profile = baseProfile({
      experience: [
        {
          title: 'Manager',
          employer: 'Delta Systems',
          current: true,
          responsibilities: [],
          achievements: [],
          employerGroupKey: 'delta-systems',
        },
        {
          title: 'Analyst',
          employer: 'Delta Systems',
          current: false,
          endDate: '2020',
          responsibilities: [],
          achievements: [],
          employerGroupKey: 'delta-systems',
        },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.experience.map((role) => role.employerGroupKey)).toEqual([
      'delta-systems',
      'delta-systems',
    ]);
  });

  it('carries education.description', () => {
    const profile = baseProfile({
      education: [
        { institution: 'Northwind University', description: 'Thesis on distributed systems.' },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.education[0].description).toBe('Thesis on distributed systems.');
  });

  it('carries certifications as their own array', () => {
    const profile = baseProfile({
      certifications: [{ name: 'AWS Solutions Architect', issuer: 'Amazon' }],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.certifications).toEqual([
      expect.objectContaining({ name: 'AWS Solutions Architect', issuer: 'Amazon' }),
    ]);
  });

  it('carries projects as their own array', () => {
    const profile = baseProfile({
      projects: [{ name: 'Internal platform', description: 'Rebuilt the deploy pipeline.' }],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.projects).toEqual([
      expect.objectContaining({ name: 'Internal platform', description: 'Rebuilt the deploy pipeline.' }),
    ]);
  });

  it.each(['A2', 'B1', 'B2', 'C1', 'C2'] as const)('carries a CEFR level (%s) through untouched', (cefr) => {
    const profile = baseProfile({ languages: [{ name: 'English', cefr }] });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.languages[0]).toMatchObject({ name: 'English', cefr });
  });

  it('carries recommendations with the author name and title, but not as dossier evidence', () => {
    const profile = baseProfile({
      recommendations: [
        {
          recommender: 'Alex Author',
          position: 'Head of Engineering',
          text: 'A pleasure to work with.',
          relationship: 'Managed directly',
        },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.recommendations?.[0]).toMatchObject({
      recommender: 'Alex Author',
      position: 'Head of Engineering',
      relationship: 'Managed directly',
    });
    expect(plan.evidence.some((item) => item.statement.includes('Alex Author'))).toBe(false);
  });

  it('carries one achievement of each kind', () => {
    const kinds = ['honor', 'publication', 'patent', 'organization', 'volunteering'] as const;
    for (const kind of kinds) {
      const profile = baseProfile({ achievements: [{ kind, title: `A ${kind}` }] });
      const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
      expect(plan.draft.achievements?.[0]).toMatchObject({ kind, title: `A ${kind}` });
    }
  });

  it('treats openToWork strictly as a proposal, never a written work preference', () => {
    const profile = baseProfile({
      openToWork: { roles: ['Product Manager'], locations: ['Berlin'], workplaceTypes: ['remote'] },
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.sourceSuggestions?.openToWork).toEqual({
      roles: ['Product Manager'],
      locations: ['Berlin'],
      workplaceTypes: ['remote'],
    });
    expect(plan.draft).not.toHaveProperty('workMode');
  });
});

describe('carriesProfileSubstance reused for the structured payload (QA spec slice 3 #12)', () => {
  it('rejects a bare profile with no name, experience, education, about or skills', () => {
    const parsed = linkedinProfileV2ToParsedResume(
      baseProfile({ fullName: undefined, headline: undefined, experience: [], education: [] }),
    );
    expect(carriesProfileSubstance(parsed)).toBe(false);
  });

  it('accepts a profile with a real role', () => {
    const profile = baseProfile({
      experience: [
        {
          title: 'Engineer',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
        },
      ],
    });
    expect(carriesProfileSubstance(linkedinProfileV2ToParsedResume(profile))).toBe(true);
  });
});

describe('collectMediaRequests / attachResumeMedia', () => {
  it('collects the photo and every employer logo url', () => {
    const profile = baseProfile({
      photoSourceUrl: 'https://media.licdn.com/dms/image/v2/photo/x',
      experience: [
        {
          title: 'Engineer',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
          employerLogoSourceUrl: 'https://media.licdn.com/dms/image/v2/logo/x',
        },
      ],
    });
    expect(collectMediaRequests(profile)).toEqual([
      { kind: 'photo', sourceUrl: 'https://media.licdn.com/dms/image/v2/photo/x' },
      { kind: 'employer_logo', sourceUrl: 'https://media.licdn.com/dms/image/v2/logo/x' },
    ]);
  });

  it('attaches resolved media ids by source url, and leaves unresolved fields unset', () => {
    const photoUrl = 'https://media.licdn.com/dms/image/v2/photo/x';
    const logoUrl = 'https://media.licdn.com/dms/image/v2/logo/x';
    const profile = baseProfile({
      photoSourceUrl: photoUrl,
      experience: [
        {
          title: 'Engineer',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
          employerLogoSourceUrl: logoUrl,
        },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    const media = new Map<string, DownloadedMedia>([
      [photoUrl, { mediaId: 'photo-id', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1]) }],
    ]);

    const draft = attachResumeMedia(plan.draft, profile, media);

    expect(draft.candidate.photoMediaId).toBe('photo-id');
    expect(draft.experience[0].employerLogoMediaId).toBeUndefined();
  });

  it('skips a dropped (title-and-employer-less) role without misattaching a later logo', () => {
    const keptLogoUrl = 'https://media.licdn.com/dms/image/v2/logo/kept';
    const profile = baseProfile({
      experience: [
        { title: '', employer: '', current: false, responsibilities: [], achievements: [] },
        {
          title: 'Engineer',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
          employerLogoSourceUrl: keptLogoUrl,
        },
      ],
    });
    const plan = planStructuredResumeImport(profile, { idPrefix: 'imp1234567' });
    expect(plan.draft.experience).toHaveLength(1);
    const media = new Map<string, DownloadedMedia>([
      [keptLogoUrl, { mediaId: 'logo-id', kind: 'employer_logo', mime: 'image/jpeg', bytes: Buffer.from([1]) }],
    ]);

    const draft = attachResumeMedia(plan.draft, profile, media);
    expect(draft.experience[0].employerLogoMediaId).toBe('logo-id');
  });
});

describe('keepFilledSections (B266)', () => {
  const existing = {
    candidate: {},
    targetRole: 'VP of Technology & Operations',
    experience: [{ id: 'e1', title: 'VP', employer: 'Kaspersky' }],
    education: [{ id: 'd1', institution: 'UTM' }],
    skills: [{ id: 's1', name: 'P&L' }],
    languages: [],
    courses: [{ id: 'c1', name: 'garbage from the text era' }],
  } as never;

  it('keeps existing entries for sections the re-import did not read', () => {
    const incoming = { candidate: {}, experience: [], education: [], skills: [], languages: [{ id: 'l1', name: 'English' }] } as never;
    const merged = keepFilledSections(incoming, existing);
    expect(merged.experience).toHaveLength(1);
    expect(merged.education).toHaveLength(1);
    expect(merged.skills).toHaveLength(1);
    expect(merged.languages).toHaveLength(1);
  });

  it('lets a section that was read replace the old one, and never revives courses', () => {
    const incoming = { candidate: {}, experience: [{ id: 'e2', title: 'CTO', employer: 'OptiLab' }], education: [], languages: [], courses: [] } as never;
    const merged = keepFilledSections(incoming, existing);
    expect(merged.experience).toEqual([{ id: 'e2', title: 'CTO', employer: 'OptiLab' }]);
    expect(merged.courses).toEqual([]);
  });

  it('keeps the existing photo when the re-import could not download a new one', () => {
    const withPhoto = { ...(existing as object), candidate: { photoMediaId: 'photo-old' } } as never;
    const incoming = { candidate: {}, experience: [], education: [], languages: [] } as never;
    expect(keepFilledSections(incoming, withPhoto).candidate.photoMediaId).toBe('photo-old');
  });

  it('takes the freshly downloaded photo over the old one', () => {
    const withPhoto = { ...(existing as object), candidate: { photoMediaId: 'photo-old' } } as never;
    const incoming = { candidate: { photoMediaId: 'photo-new' }, experience: [], education: [], languages: [] } as never;
    expect(keepFilledSections(incoming, withPhoto).candidate.photoMediaId).toBe('photo-new');
  });

  it('never clears the candidate target role that drives the campaign', () => {
    const incoming = { candidate: {}, experience: [], education: [], languages: [] } as never;
    expect(keepFilledSections(incoming, existing).targetRole).toBe('VP of Technology & Operations');
  });
});
