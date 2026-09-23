import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLinkedInProfile } from './linkedinProfileExtract';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
}

describe('extractLinkedInProfile (B264)', () => {
  const scrolled = extractLinkedInProfile(fixture('linkedin-profile-scrolled.html'));
  const topCardOnly = extractLinkedInProfile(fixture('linkedin-profile-top-card-only.html'));

  it('reads the top card past the verification badge', () => {
    expect(scrolled.fullName).toBe('Alexey Denisov');
    expect(scrolled.headline).toMatch(/^VP of Technology & Operations \| Ex-Co-Founder/u);
    expect(scrolled.location).toBe('Dubai, United Arab Emirates');
    expect(topCardOnly.headline).toBe(scrolled.headline);
  });

  it('keeps the candidate’s own sections as resume headings', () => {
    for (const heading of ['Summary', 'Experience', 'Education', 'Certifications', 'Projects']) {
      expect(scrolled.text).toMatch(new RegExp(`^${heading}$`, 'mu'));
    }
    expect(scrolled.text).toContain('I build, scale, and transform technology organizations');
    expect(scrolled.text).toContain('Co-Founder & COO (Chief Operating Officer)');
    expect(scrolled.text).toContain('Universitatea Tehnică a Moldovei');
    expect(scrolled.text).toContain('Agile Fundamentals');
    expect(scrolled.text).toContain('Native or bilingual proficiency');
  });

  it('drops the verification badge, other people, analytics, ads and the footer', () => {
    for (const noise of [
      'Verify in 2 minutes',
      'Placeholder',
      'Макс',
      'profile views',
      'Restart Premium',
      'Ad Options',
      'Talent Solutions',
      'Community Guidelines',
      'Show all',
      '+4 skills',
      'Add connected apps',
    ]) {
      expect(scrolled.text).not.toContain(noise);
    }
  });

  it('never turns the footer into an About section when sections have not loaded', () => {
    expect(topCardOnly.text).not.toMatch(/^Summary$/mu);
    expect(topCardOnly.text).not.toContain('Accessibility');
    expect(topCardOnly.text).not.toContain('Verify in 2 minutes');
    expect(topCardOnly.sectionCount).toBe(0);
    expect(scrolled.sectionCount).toBeGreaterThanOrEqual(5);
  });

  it('decodes entities and ignores scripts', () => {
    const result = extractLinkedInProfile(
      '<main><div>Jane Doe</div><div>Head of R&amp;D</div><div>Berlin, Germany</div>' +
        '<div>·</div><div>Contact info</div><script>var x = "Experience";</script>' +
        '<div>About</div><div>Builds &lt;teams&gt; &#38; products</div></main>',
    );
    expect(result.headline).toBe('Head of R&D');
    expect(result.location).toBe('Berlin, Germany');
    expect(result.text).toContain('Builds <teams> & products');
  });
});
