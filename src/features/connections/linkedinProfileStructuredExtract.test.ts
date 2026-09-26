// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeSafetyGoUrl } from './linkedinDom';
import { parseEducationSection, parseExperienceSection } from './linkedinExperienceExtract';
import {
  parseCertificationsSection,
  parseCoursesSection,
  parseProjectsSection,
  parseRecommendationsSection,
  parseSkillsSection,
} from './linkedinCredentialExtract';
import {
  LI_SDUI_EXTRACTOR_VERSION,
  extractStructuredLinkedInProfile,
  extractStructuredLinkedInProfileTolerant,
  parseAboutSection,
  parseAchievementCard,
  parseContactInfo,
  parseLanguagesSection,
  parseOpenToWork,
  parseTopCard,
} from './linkedinProfileStructuredExtract';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', 'linkedin', name), 'utf8');
}

describe('parseTopCard (B265)', () => {
  const topCard = parseTopCard(fixture('profile.html'));

  it('extracts headline separately from the verification badge', () => {
    expect(topCard.fullName).toBe('Jordan Rivers');
    expect(topCard.headline).not.toContain('Verify');
    expect(topCard.fullName).not.toContain('Verify');
    expect(topCard.headline).toMatch(/^VP of Technology & Operations/u);
  });

  it('extracts photoSourceUrl from the top card img src', () => {
    expect(topCard.photoSourceUrl).toBe(
      'https://media.licdn.com/dms/image/v2/SYNTH001/profile-displayphoto-shrink_100_100/0/1000000000/synthetic?e=1000000000&v=beta&t=synthetic',
    );
  });
});

describe('parseExperienceSection (B265)', () => {
  const roles = parseExperienceSection(fixture('experience.html'));

  it('splits title/employer/employmentType/dates/duration', () => {
    const current = roles.find((role) => role.current);
    expect(current?.title).toBe('Independent AI Consultant & Solutions Architect');
    expect(current?.employer).toBe('Northwind Labs');
    expect(current?.employmentType).toBe('Self-employed');
    expect(current?.startDate).toBe('Nov 2025');
    expect(current?.endDate).toBeUndefined();
    expect(JSON.stringify(current)).not.toContain('11 mos');
  });

  it('splits role description into responsibilities bullets, not one blob', () => {
    const current = roles.find((role) => role.current);
    expect(current?.responsibilities.length).toBeGreaterThan(1);
    expect(current?.responsibilities[0]).not.toMatch(/^•/u);
  });

  it('reads skills from the "X, Y and +4 skills" line without expanding the +N', () => {
    const withSkills = roles.find((role) => role.skills && role.skills.length > 0);
    expect(withSkills?.skills).toEqual(
      expect.arrayContaining(['n8n', 'Software as a Service (SaaS)']),
    );
    expect(withSkills?.skills?.some((skill) => skill.includes('+'))).toBe(false);
  });

  it('reads employerLogoSourceUrl restricted to the media.licdn.com company-logo path', () => {
    const withLogo = roles.find((role) => role.employerLogoSourceUrl);
    expect(withLogo?.employerLogoSourceUrl).toMatch(
      /^https:\/\/media\.licdn\.com\/dms\/image\/.*company-logo_100_100/u,
    );
  });

  it('groups multiple roles under one employer (synthetic)', () => {
    const grouped = parseExperienceSection(fixture('experience-grouped-employer.html'));
    expect(grouped).toHaveLength(3);
    const keys = new Set(grouped.map((role) => role.employerGroupKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBeTruthy();
    for (const role of grouped) expect(role.employer).toBe('Northwind Labs');
    expect(grouped.map((role) => role.title)).toEqual([
      'Director of Platform Engineering',
      'Senior Engineering Manager',
      'Engineering Manager',
    ]);
  });
});

describe('parseEducationSection (B265)', () => {
  it('reads education[].description', () => {
    const entries = parseEducationSection(fixture('education.html'));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.description && entry.description.length > 0)).toBe(true);
  });
});

describe('parseCertificationsSection (B265)', () => {
  it('parses certifications as a separate type, including expiry', () => {
    const certifications = parseCertificationsSection(fixture('certifications.html'));
    expect(certifications).toHaveLength(4);
    const withExpiry = certifications.find((cert) => cert.expiresAt);
    expect(withExpiry?.issuedAt).toBe('Jan 2023');
    expect(withExpiry?.expiresAt).toBe('Jan 2028');
    expect(certifications[0]).toEqual(
      expect.objectContaining({
        name: 'Delivery Fundamentals',
        issuer: 'Synthetic Alliance',
        issuedAt: 'Apr 2023',
      }),
    );
  });
});

describe('parseProjectsSection (B265)', () => {
  it('parses projects with dates and description', () => {
    const projects = parseProjectsSection(fixture('projects.html'));
    expect(projects).toHaveLength(7);
    const wellbridge = projects.find((project) => project.name.startsWith('Wellbridge.io'));
    expect(wellbridge?.startDate).toBe('Apr 2026');
    expect(wellbridge?.current).toBe(true);
    expect(wellbridge?.description).toBeTruthy();
    expect(wellbridge?.description).not.toContain('more');
    expect(wellbridge?.employer).toBe('Northwind Labs');
  });
});

describe('parseSkillsSection (B265)', () => {
  it('reads the full skills list from details/skills, not the profile preview', () => {
    const skills = parseSkillsSection(fixture('skills.html'));
    expect(skills.length).toBeGreaterThanOrEqual(40);
    expect(skills).toContain('Turn Around Management');
  });
});

describe('parseLanguagesSection (B265)', () => {
  const synthetic =
    '<div><p>English</p><p>Full professional proficiency</p>' +
    '<p>Russian</p><p>Native or bilingual proficiency</p>' +
    '<p>Klingon</p><p>Beginner proficiency</p></div>';

  it('reads languages only from the given page (profile.html), ignoring the empty details page', () => {
    expect(parseLanguagesSection(fixture('languages-empty-details.html'))).toEqual([]);
    expect(parseLanguagesSection(synthetic).slice(0, 2)).toEqual([
      { name: 'English', cefr: 'C1', sourceLabel: 'Full professional proficiency' },
      { name: 'Russian', cefr: 'C2', sourceLabel: 'Native or bilingual proficiency' },
    ]);
  });

  it('maps every LinkedIn proficiency label to CEFR via the agreed dictionary', () => {
    const pairs: [string, string][] = [
      ['Elementary proficiency', 'A2'],
      ['Limited working proficiency', 'B1'],
      ['Professional working proficiency', 'B2'],
      ['Full professional proficiency', 'C1'],
      ['Native or bilingual proficiency', 'C2'],
    ];
    for (const [level, cefr] of pairs) {
      const [language] = parseLanguagesSection(`<p>Test</p><p>${level}</p>`);
      expect(language.cefr).toBe(cefr);
    }
  });

  it('maps Russian LinkedIn proficiency labels to the same CEFR levels', () => {
    const pairs: [string, string][] = [
      ['Начальный уровень', 'A2'],
      ['Ограниченный рабочий уровень', 'B1'],
      ['Профессиональный рабочий уровень', 'B2'],
      ['Полный профессиональный уровень', 'C1'],
      ['Родной или двуязычный уровень', 'C2'],
    ];
    for (const [level, cefr] of pairs) {
      const [language] = parseLanguagesSection(`<p>Test</p><p>${level}</p>`);
      expect(language.cefr).toBe(cefr);
      expect(language.name).toBe('Test');
    }
  });

  it('keeps an unknown proficiency label without a CEFR mapping (no silent guess)', () => {
    const [language] = parseLanguagesSection(
      synthetic.replace(/[\s\S]*(Klingon)/u, '<p>$1</p>') + '<p>Beginner proficiency</p>',
    );
    expect(language.name).toBe('Klingon');
    expect(language.cefr).toBeUndefined();
  });
});

describe('parseRecommendationsSection (B265)', () => {
  it('imports recommendations with author name and title', () => {
    const recommendations = parseRecommendationsSection(fixture('recommendations.html'));
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]).toEqual(
      expect.objectContaining({
        recommender: 'Taylor Quinn',
        position: 'Chief Technology Officer at Northwind Labs',
      }),
    );
    expect(recommendations[0].text).toContain('platform leaders');
  });
});

describe('parseAchievementCard (B265)', () => {
  it('merges honors/publications/patents/organizations/volunteering into one shape with a kind', () => {
    const honor = parseAchievementCard(fixture('achievements-honor.html'), 'honor');
    const publication = parseAchievementCard(
      fixture('achievements-publication.html'),
      'publication',
    );
    const patent = parseAchievementCard(fixture('achievements-patent.html'), 'patent');
    const organization = parseAchievementCard(
      fixture('achievements-organization.html'),
      'organization',
    );
    const volunteering = parseAchievementCard(
      fixture('achievements-volunteering.html'),
      'volunteering',
    );

    expect(honor).toEqual(
      expect.objectContaining({
        kind: 'honor',
        title: 'Platform Team of the Year',
        issuer: 'Northwind Labs',
      }),
    );
    expect(publication?.url).toBe('https://example.com/publications/scaling-on-call');
    expect(patent?.kind).toBe('patent');
    expect(organization).toEqual(expect.objectContaining({ kind: 'organization', role: 'Member' }));
    expect(volunteering).toEqual(
      expect.objectContaining({
        kind: 'volunteering',
        title: 'Mentor',
        issuer: 'Synthetic Code for Good',
      }),
    );
  });
});

describe('parseOpenToWork (B265)', () => {
  it('reads roles/locations/workplaceTypes as a proposal', () => {
    const openToWork = parseOpenToWork(fixture('open-to-work.html'));
    expect(openToWork?.roles).toEqual([
      'VP of Technology',
      'Director of Platform Engineering',
      'Head of Engineering',
    ]);
    expect(openToWork?.locations).toEqual(['Remote City, Testland']);
    expect(openToWork?.workplaceTypes).toEqual(['on_site', 'hybrid', 'remote']);
  });
});

describe('parseContactInfo (B265)', () => {
  const contact = parseContactInfo(fixture('contact-info.html'));

  it('reads email, phone, links (Telegram by t.me, safety/go decoded) and linkedinUrl', () => {
    expect(contact.email).toBe('jordan.rivers@example.com');
    expect(contact.phone).toContain('+1 555 010 1234');
    expect(contact.telegram).toBe('https://t.me/jordanrivers');
    expect(contact.links).toEqual(['https://wellbridge.io']);
    expect(contact.linkedinUrl).toBe('https://www.linkedin.com/in/jordanrivers-99a1b2/');
  });

  it('drops the Premium ad row (label not in the dictionary)', () => {
    expect(contact.links.join(' ')).not.toContain('premium');
  });

  it('never extracts Birthday into any output field', () => {
    expect(JSON.stringify(contact)).not.toContain('March 3');
  });
});

describe('extractStructuredLinkedInProfile (B265)', () => {
  it('assembles the full profile and never leaks Birthday anywhere in the result', () => {
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

    expect(JSON.stringify(profile)).not.toContain('March 3');
    expect(profile.fullName).toBe('Jordan Rivers');
    expect(profile.experience.length).toBeGreaterThan(0);
    expect(profile.certifications).toHaveLength(4);
    expect(profile.projects).toHaveLength(7);
    expect(profile.achievements).toHaveLength(1);
    expect(profile.contact.linkedinUrl).toContain('jordanrivers');
    expect((profile as Record<string, unknown>).birthday).toBeUndefined();
  });

  it('tags a stable extractorVersion', () => {
    expect(LI_SDUI_EXTRACTOR_VERSION).toBe('li-sdui-1');
  });
});

describe('decodeSafetyGoUrl (B265 security)', () => {
  const wrap = (target: string): string =>
    `https://www.linkedin.com/safety/go/?url=${encodeURIComponent(target)}`;

  it('returns the real https site behind the redirector', () => {
    expect(decodeSafetyGoUrl(wrap('https://example.dev/a?b=1'))).toBe('https://example.dev/a?b=1');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://example.dev/', 'not a url at all'])(
    'drops a non-https target: %s',
    (target) => {
      expect(decodeSafetyGoUrl(wrap(target))).toBeUndefined();
    },
  );

  it('decodes exactly once (a double-encoded target stays encoded, not unwrapped twice)', () => {
    const doubly = encodeURIComponent('https://example.dev/%2Fpath');
    expect(decodeSafetyGoUrl(wrap(doubly))).toBeUndefined();
  });
});

describe('sections LinkedIn leaves only on the main profile (B266)', () => {
  it('takes education from the main profile when its details page came back empty', () => {
    const profile = extractStructuredLinkedInProfile({
      profile: fixture('education.html'),
      education: '<main></main>',
    });
    expect(profile.education.length).toBe(2);
  });

  it('prefers a non-empty details page over the main profile', () => {
    const profile = extractStructuredLinkedInProfile({
      profile: '<main></main>',
      education: fixture('education.html'),
    });
    expect(profile.education.length).toBe(2);
  });
});

describe('languages without paragraph markup (B266)', () => {
  it('pairs a language with its proficiency from plain leaf text', () => {
    const html = `<main><section><div><span>Languages</span></div>
      <div><div><span aria-hidden="true">English</span></div><div><span>Full professional proficiency</span></div></div>
      <div><div><span aria-hidden="true">Russian</span></div><div><span>Native or bilingual proficiency</span></div></div>
      </section></main>`;
    expect(
      parseLanguagesSection(html).map((language) => [language.name, language.sourceLabel]),
    ).toEqual([
      ['English', 'Full professional proficiency'],
      ['Russian', 'Native or bilingual proficiency'],
    ]);
  });
});

describe('languages written as text beside inline markup (B266)', () => {
  it('reads pairs whose text sits next to child elements', () => {
    const html = `<main><section><h2>Languages</h2>
      <div>English<span class="visually-hidden"></span><div>Full professional proficiency<!----></div></div>
      <div>Russian<span></span><div>Native or bilingual proficiency</div></div></section></main>`;
    expect(parseLanguagesSection(html).map((language) => language.name)).toEqual([
      'English',
      'Russian',
    ]);
  });
});

describe('About card (B266)', () => {
  it('reads the summary from the About card, one line per LinkedIn line break', () => {
    expect(parseAboutSection(fixture('about.html'))).toBe(
      [
        'I build and scale technology organizations.',
        'Over 15+ years I have led IT and cloud operations.',
        '• 4x revenue growth across two divisions.',
        'Open to VP of Technology roles.',
      ].join('\n'),
    );
  });

  it('ignores the footer «About» link and other cards when the About card is absent', () => {
    expect(parseAboutSection(fixture('profile.html'))).toBeUndefined();
  });

  it('carries the summary into the assembled profile', () => {
    const profile = extractStructuredLinkedInProfile({
      profile: fixture('profile.html') + fixture('about.html'),
    });
    expect(profile.about).toMatch(/^I build and scale technology organizations\./u);
  });
});

describe('extractStructuredLinkedInProfileTolerant (B266)', () => {
  it('empties only the section whose parser threw and names it', () => {
    const { profile, failedSections } = extractStructuredLinkedInProfileTolerant({
      profile: fixture('profile.html') + fixture('about.html'),
      achievements: 'not a list' as never,
    });
    expect(failedSections).toEqual(['achievements']);
    expect(profile.achievements).toEqual([]);
    expect(profile.fullName).toBe('Jordan Rivers');
    expect(profile.about).toMatch(/^I build/u);
  });
});

const MAIN_PROFILE_COURSES_CARD = `<main><section componentkey="c1">
<div componentkey="com.linkedin.sdui.profile.card.refSynthCourseTopLevelSection">
<h2>Courses</h2>
<div><p>Incident Command Basics</p><div><figure aria-hidden="true"></figure><p>Associated with Meridian Security</p></div></div>
<div><p>Cloud Cost Control</p></div>
<a componentkey="synth_courses_showAll" href="https://www.linkedin.com/in/synth/details/courses/">Show all</a>
</div></section></main>`;

describe('parseCoursesSection (B266)', () => {
  it('reads every course with the organisation it is associated with', () => {
    expect(parseCoursesSection(fixture('courses.html'))).toEqual([
      { name: 'Customer Care & Communication Skills', institution: 'Meridian Security' },
      { name: 'DevOps Engineering & Automation', institution: 'Northshore Tech Academy' },
      { name: 'Synthetic Framework v3 Service Lifecycle Fundamentals', institution: 'Meridian Security' },
    ]);
  });

  it('reads the preview card on the main profile, a course without an organisation included', () => {
    expect(parseCoursesSection(MAIN_PROFILE_COURSES_CARD)).toEqual([
      { name: 'Incident Command Basics', institution: 'Meridian Security' },
      { name: 'Cloud Cost Control' },
    ]);
  });

  it('ignores paragraphs outside the courses card', () => {
    expect(parseCoursesSection('<main><p>Why am I seeing this ad?</p></main>')).toEqual([]);
  });

  it('takes courses from the details page and falls back to the main profile', () => {
    const fromDetails = extractStructuredLinkedInProfile({
      profile: MAIN_PROFILE_COURSES_CARD,
      courses: fixture('courses.html'),
    });
    expect(fromDetails.courses).toHaveLength(3);
    const fromMain = extractStructuredLinkedInProfile({
      profile: MAIN_PROFILE_COURSES_CARD,
      courses: '<main></main>',
    });
    expect(fromMain.courses.map((course) => course.name)).toEqual([
      'Incident Command Basics',
      'Cloud Cost Control',
    ]);
  });
});
