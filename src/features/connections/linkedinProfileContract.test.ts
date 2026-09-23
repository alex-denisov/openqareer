// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkedinProfileV2Schema } from '../../../shared/linkedinProfileV2';
import { extractStructuredLinkedInProfile } from './linkedinProfileStructuredExtract';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__/linkedin', name), 'utf8');

describe('LinkedIn extractor ↔ server contract (B265)', () => {
  it('produces a profile the server schema accepts from every captured page', () => {
    const profile = extractStructuredLinkedInProfile({
      profile: fixture('profile.html'),
      experience: fixture('experience.html'),
      education: fixture('education.html'),
      certifications: fixture('certifications.html'),
      projects: fixture('projects.html'),
      skills: fixture('skills.html'),
      contactInfo: fixture('contact-info.html'),
      recommendations: fixture('recommendations.html'),
      achievements: [{ kind: 'honor', html: fixture('achievements-honor.html') }],
    });

    const result = linkedinProfileV2Schema.safeParse(profile);

    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});
