import { describe, expect, it } from 'vitest';
import { sanitizeLinkedInProfileV2, validLinkedInProfileWithDrops } from './linkedinProfileSanitize';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';

function baseProfile(): LinkedInProfileV2 {
  return {
    fullName: 'Alex Denisov',
    headline: 'Staff Engineer',
    contact: { links: [] },
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
  };
}

describe('sanitizeLinkedInProfileV2', () => {
  it('passes a fully valid profile through untouched', () => {
    const profile = baseProfile();
    expect(sanitizeLinkedInProfileV2(profile)).toEqual(profile);
  });

  it('drops an invalid experience item instead of failing the whole import (M2 case 22)', () => {
    const valid = { title: 'Engineer', employer: 'OpenQareer', current: true, responsibilities: [], achievements: [] };
    const invalid = { title: 'x'.repeat(400), current: true }; // over `optionalCaption` max(300)
    const profile = { ...baseProfile(), experience: [valid, invalid] as never };
    const result = sanitizeLinkedInProfileV2(profile);
    expect(result.experience).toEqual([valid]);
  });

  it('drops an invalid skill string instead of failing the whole import (M2 case 23)', () => {
    const profile = { ...baseProfile(), skills: ['TypeScript', 'x'.repeat(400)] };
    const result = sanitizeLinkedInProfileV2(profile);
    expect(result.skills).toEqual(['TypeScript']);
  });

  it('drops an invalid top-level scalar field but keeps the rest', () => {
    const profile = { ...baseProfile(), photoSourceUrl: 'not-a-url' } as unknown as LinkedInProfileV2;
    const result = sanitizeLinkedInProfileV2(profile);
    expect(result.photoSourceUrl).toBeUndefined();
    expect(result.fullName).toBe('Alex Denisov');
  });

  it('always returns a schema-valid profile', async () => {
    const { linkedinProfileV2Schema } = await import('../../../shared/linkedinProfileV2');
    const profile = { ...baseProfile(), skills: ['ok', 'y'.repeat(400)] };
    const result = sanitizeLinkedInProfileV2(profile);
    expect(linkedinProfileV2Schema.safeParse(result).success).toBe(true);
  });
});

describe('validLinkedInProfileWithDrops (B266)', () => {
  it('drops a bad contact field instead of rejecting the whole profile', () => {
    const profile = {
      ...baseProfile(),
      skills: ['P&L'],
      contact: { links: [], email: 'not an email', phone: '+971 50 000 0000' },
    } as LinkedInProfileV2;
    const result = validLinkedInProfileWithDrops(profile);
    expect(result?.profile.contact.email).toBeUndefined();
    expect(result?.profile.contact.phone).toBe('+971 50 000 0000');
    expect(result?.profile.skills).toEqual(['P&L']);
    expect(result?.dropped).toEqual(['contact.email']);
  });

  it('trims lists to the schema ceiling and reports it', () => {
    const links = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}`);
    const skills = Array.from({ length: 120 }, (_, i) => `Skill ${i}`);
    const profile = { ...baseProfile(), skills, contact: { links } } as LinkedInProfileV2;
    const result = validLinkedInProfileWithDrops(profile);
    expect(result?.profile.skills).toHaveLength(100);
    expect(result?.profile.contact.links).toHaveLength(20);
    expect(result?.dropped).toEqual(expect.arrayContaining(['skills', 'contact.links']));
  });

  it('reports nothing for a clean profile', () => {
    expect(validLinkedInProfileWithDrops(baseProfile())?.dropped).toEqual([]);
  });
});
