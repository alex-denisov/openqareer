import { describe, expect, it } from 'vitest';
import type { ParsedResume } from './resumeParserTypes';
import { resumeSourceCoverage } from '../resume/resumeSourceCoverage';
import { usedEvidenceIds } from '../resume/resumeDocumentRows';
import type { ResumeDraft } from '../resume/resumeTypes';

/**
 * Smoke test for B265 slice 1: the new optional `ParsedResume`/`ResumeDraft`
 * v2 fields must not break existing consumers. Full extractor/projection
 * coverage of these fields is slice 5/6 work — this only proves the type
 * extension is additive and existing readers keep working.
 */
describe('ParsedResume v2 fields do not break existing consumers', () => {
  it('a ParsedResume literal using every new v2 field type-checks', () => {
    const resume: ParsedResume = {
      fullName: 'Jordan Rivers',
      headline: 'VP of Engineering',
      photoSourceUrl: 'https://media.licdn.com/dms/image/v2/example/profile-displayphoto',
      about: 'Runs platform teams.',
      contact: {
        links: [],
        linkedinUrl: 'https://www.linkedin.com/in/jordan-rivers',
      },
      experience: [
        {
          title: 'VP of Engineering',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: [],
          achievements: [],
          employmentType: 'Full-time',
          workplaceType: 'hybrid',
          skills: ['Python', 'Go'],
          employerLogoSourceUrl: 'https://media.licdn.com/dms/image/v2/example/company-logo',
          employerGroupKey: 'group-northwind-labs',
        },
      ],
      skills: [],
      education: [
        {
          institution: 'Example University',
          description: 'Focused on distributed systems.',
        },
      ],
      courses: [],
      tests: [],
      recommendations: [
        { recommender: 'Alex Third-Party', text: 'Great to work with.', relationship: 'Manager', date: '2023-01' },
      ],
      languages: [],
      certifications: [{ name: 'AWS Certified Solutions Architect', issuer: 'Amazon' }],
      projects: [{ name: 'Platform migration', description: 'Migrated to Kubernetes.' }],
      achievements: [{ kind: 'honor', title: 'Engineer of the year' }],
      openToWork: { roles: ['VP of Engineering'], locations: ['Berlin'], workplaceTypes: ['hybrid'] },
      rawText: 'raw',
    };

    expect(resume.headline).toBe('VP of Engineering');
  });

  it('resumeSourceCoverage does not throw on a v2 draft with new fields', () => {
    const draft: ResumeDraft = {
      schemaVersion: 2,
      candidate: {
        fullName: 'Jordan Rivers',
        headline: 'VP of Engineering',
        contact: { links: [] },
      },
      experience: [],
      education: [],
      languages: [],
      certifications: [{ id: 'cert-1', name: 'AWS Certified' }],
      projects: [{ id: 'proj-1', name: 'Platform migration' }],
      achievements: [{ id: 'ach-1', kind: 'honor', title: 'Engineer of the year' }],
    };

    expect(() => resumeSourceCoverage(draft)).not.toThrow();
    expect(() => usedEvidenceIds(draft)).not.toThrow();
  });
});
