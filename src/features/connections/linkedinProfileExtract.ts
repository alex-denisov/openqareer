/**
 * Turns the candidate's own LinkedIn profile page into resume-shaped text.
 *
 * The page is a mix of the candidate's sections and LinkedIn's own chrome:
 * a verification badge above the headline, analytics, other people's posts
 * and profiles, ads and a footer whose first link is "About". Reading it
 * whole put the footer into "О себе" and the badge into the headline (B264),
 * so only the top card and a whitelist of the candidate's sections survive.
 */

export interface LinkedInProfileExtract {
  readonly fullName?: string;
  readonly headline?: string;
  readonly location?: string;
  /** Resume-shaped text: top card, then kept sections under resume headings. */
  readonly text: string;
  readonly sectionCount: number;
}

/** LinkedIn heading → the heading the resume parser already understands. */
const KEPT_SECTIONS: Readonly<Record<string, string>> = {
  about: 'Summary',
  experience: 'Experience',
  education: 'Education',
  'licenses & certifications': 'Certifications',
  projects: 'Projects',
  skills: 'Skills',
  'top skills': 'Top Skills',
  courses: 'Courses',
  languages: 'Languages',
  'honors & awards': 'Honors & Awards',
  'volunteer experience': 'Volunteering',
  volunteering: 'Volunteering',
  publications: 'Publications',
};

/** Sections that belong to LinkedIn or to other people, never to the resume. */
const DROPPED_SECTIONS = new Set([
  'activity',
  'featured',
  'analytics',
  'resources',
  'suggested for you',
  'interests',
  'connected apps',
  'recommendations',
  'people also viewed',
  'people you may know',
  'services',
  'causes',
]);

/** Everything from here on is page chrome: profile settings, ads, footer. */
const PAGE_END_MARKERS = ['Profile language', 'Public profile & URL', 'Ad Options'];

const BADGE_LINE = /^(?:verify(?: now| in \d+ minutes?)?|verified)$/iu;
const NOISE_LINE = [
  /^(?:…|\.\.\.|more|see more|\+|·)$/iu,
  /^show all\b/iu,
  /\band \+\d+ skills?$/iu,
  /^add connected apps$/iu,
];

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/** Text lines of the snapshot, split at every tag — the reading the text importer uses. */
export function htmlToLines(html: string): string[] {
  const main = /<main\b[^>]*>([\s\S]*)<\/main>/iu.exec(html)?.[1] ?? html;
  return decodeEntities(
    main
      .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/giu, ' ')
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<[^>]+>/gu, '\n'),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length > 0);
}

function withoutPageChrome(lines: readonly string[]): readonly string[] {
  const end = lines.findIndex(
    (line) => PAGE_END_MARKERS.includes(line) || line.startsWith('LinkedIn Corporation ©'),
  );
  return end === -1 ? lines : lines.slice(0, end);
}

function sectionKey(line: string): string {
  return line.replace(/\s*\(\d+\)$/u, '').toLowerCase();
}

function isSectionHeading(line: string): boolean {
  const key = sectionKey(line);
  return key in KEPT_SECTIONS || DROPPED_SECTIONS.has(key);
}

function isNoise(line: string): boolean {
  return NOISE_LINE.some((pattern) => pattern.test(line));
}

interface TopCard {
  readonly fullName?: string;
  readonly headline?: string;
  readonly location?: string;
}

function readTopCard(lines: readonly string[]): TopCard {
  const [fullName, ...rest] = lines;
  const headline = rest.find((line) => !BADGE_LINE.test(line));
  const contactIndex = lines.indexOf('Contact info');
  const location =
    contactIndex > 0
      ? lines
          .slice(0, contactIndex)
          .reverse()
          .find((line) => line !== '·')
      : undefined;
  return { fullName, headline, location: location === headline ? undefined : location };
}

function readSections(lines: readonly string[]): readonly string[][] {
  const sections: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    if (isSectionHeading(line)) {
      const heading = KEPT_SECTIONS[sectionKey(line)];
      current = heading ? [heading] : undefined;
      if (current) sections.push(current);
      continue;
    }
    if (current && !isNoise(line)) current.push(line);
  }
  return sections.filter((section) => section.length > 1);
}

export function extractLinkedInProfile(html: string): LinkedInProfileExtract {
  const lines = withoutPageChrome(htmlToLines(html));
  const firstHeading = lines.findIndex(isSectionHeading);
  const topCard = readTopCard(firstHeading === -1 ? lines : lines.slice(0, firstHeading));
  const sections = readSections(lines);
  const header = [topCard.fullName, topCard.headline, topCard.location].filter(
    (line): line is string => Boolean(line),
  );
  const text = [header.join('\n'), ...sections.map((section) => section.join('\n'))]
    .filter((block) => block.length > 0)
    .join('\n\n');
  return { ...topCard, text, sectionCount: sections.length };
}
