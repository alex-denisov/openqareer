/**
 * Structured LinkedIn extractor by markup anchors (B265 §2/§5, architecture.md
 * §1/§2). Each card gets its own function; `extractStructuredLinkedInProfile`
 * only assembles the pages the caller happened to capture. The text-based
 * `extractLinkedInProfile` (B264) stays untouched as the fallback path.
 */
import type { CefrLevel } from '../resume/resumeTypes';
import type {
  ParsedResumeAchievement,
  ParsedResumeAchievementKind,
  ParsedResumeLanguage,
  ParsedResumeOpenToWork,
  ParsedWorkplaceType,
} from '../workspace/resumeParserTypes';
import { parseEducationSection, parseExperienceSection } from './linkedinExperienceExtract';
import {
  parseCertificationsSection,
  parseProjectsSection,
  parseRecommendationsSection,
  parseSkillsSection,
} from './linkedinCredentialExtract';
import { decodeSafetyGoUrl, mediaSourceUrl, paragraphsOf, parseFragment, textOf } from './linkedinDom';

/** Logged with the payload so a markup drift shows up server-side (architecture §2). */
export const LI_SDUI_EXTRACTOR_VERSION = 'li-sdui-1';

/** The "form" of ParsedResume v2 sent over the wire — no `rawText` (architecture §2). */
export type LinkedInProfileV2 = Omit<
  ReturnType<typeof emptyLinkedInProfileV2>,
  never
>;

function emptyLinkedInProfileV2() {
  return {
    fullName: undefined as string | undefined,
    headline: undefined as string | undefined,
    photoSourceUrl: undefined as string | undefined,
    about: undefined as string | undefined,
    contact: { links: [] as string[] } as {
      email?: string;
      phone?: string;
      telegram?: string;
      location?: string;
      links: string[];
      linkedinUrl?: string;
    },
    experience: [] as ReturnType<typeof parseExperienceSection>,
    skills: [] as string[],
    education: [] as ReturnType<typeof parseEducationSection>,
    courses: [] as never[],
    tests: [] as never[],
    recommendations: [] as ReturnType<typeof parseRecommendationsSection>,
    languages: [] as ParsedResumeLanguage[],
    certifications: [] as ReturnType<typeof parseCertificationsSection>,
    projects: [] as ReturnType<typeof parseProjectsSection>,
    achievements: [] as ParsedResumeAchievement[],
    openToWork: undefined as ParsedResumeOpenToWork | undefined,
  };
}

const BADGE_LINE = /^verify(?: now| in \d+ minutes?)?$/iu;

interface TopCard {
  readonly fullName?: string;
  readonly headline?: string;
  readonly photoSourceUrl?: string;
  readonly location?: string;
}

/** Top card: name, headline past the verification badge, photo, location. */
export function parseTopCard(html: string): TopCard {
  const doc = parseFragment(html);
  const fullName = textOf(doc.querySelector('h2'));
  const photoSourceUrl = mediaSourceUrl(doc.querySelector('img')?.getAttribute('src'));
  const paragraphs = paragraphsOf(doc.body).filter((line) => !BADGE_LINE.test(line));
  const contactIndex = paragraphs.findIndex((line) => line === 'Contact info');
  const headline = paragraphs[0];
  let locationIndex = contactIndex - 1;
  while (locationIndex >= 0 && paragraphs[locationIndex] === '·') locationIndex -= 1;
  const location = contactIndex > 0 && locationIndex >= 0 ? paragraphs[locationIndex] : undefined;
  return { fullName, headline, photoSourceUrl, location: location === headline ? undefined : location };
}

const CEFR_BY_LINKEDIN_LABEL: Readonly<Record<string, CefrLevel>> = {
  elementary: 'A2',
  'limited working': 'B1',
  'professional working': 'B2',
  'full professional': 'C1',
  'native or bilingual': 'C2',
};

function cefrOf(proficiency: string): CefrLevel | undefined {
  const label = proficiency.replace(/\s*proficiency$/iu, '').trim().toLowerCase();
  return CEFR_BY_LINKEDIN_LABEL[label];
}

/** Languages live only on `profile.html`; the details page renders a false empty state (B264 §6). */
export function parseLanguagesSection(html: string): ParsedResumeLanguage[] {
  const paragraphs = paragraphsOf(parseFragment(html).body);
  const languages: ParsedResumeLanguage[] = [];
  for (let i = 0; i < paragraphs.length - 1; i += 1) {
    if (!/proficiency$/iu.test(paragraphs[i + 1])) continue;
    languages.push({
      name: paragraphs[i],
      cefr: cefrOf(paragraphs[i + 1]),
      sourceLabel: paragraphs[i + 1],
    });
    i += 1;
  }
  return languages;
}

const CONTACT_LABELS = new Set(['Your profile', 'Website', 'Phone', 'Email']);

interface ContactInfo {
  email?: string;
  phone?: string;
  telegram?: string;
  linkedinUrl?: string;
  links: string[];
}

/** Contact info overlay, per the "Досъём" anatomy in B264 (dialog → lazy-column → rows). */
export function parseContactInfo(html: string): ContactInfo {
  const doc = parseFragment(html);
  const rows = Array.from(doc.querySelectorAll('[data-testid="lazy-column"] > div[componentkey]'));
  const result: ContactInfo = { links: [] };
  for (const row of rows) {
    const [label] = paragraphsOf(row);
    if (!label || !CONTACT_LABELS.has(label)) continue;
    const href = row.querySelector('a')?.getAttribute('href') ?? undefined;
    if (label === 'Your profile') result.linkedinUrl = href;
    if (label === 'Website' && href) {
      const decoded = decodeSafetyGoUrl(href);
      if (!decoded) continue;
      if (/(^|\.)t\.me$/u.test(new URL(decoded).hostname)) result.telegram = decoded;
      else result.links = [...result.links, decoded];
    }
    if (label === 'Phone') result.phone = paragraphsOf(row).slice(1).join(' ');
    if (label === 'Email') result.email = paragraphsOf(row)[1];
  }
  return result;
}

const WORKPLACE_LABELS: Readonly<Record<string, ParsedWorkplaceType>> = {
  'on-site': 'on_site',
  hybrid: 'hybrid',
  remote: 'remote',
};

/** The Topcard "Open to work" carousel card — a proposal only (architecture §10). */
export function parseOpenToWork(html: string): ParsedResumeOpenToWork | undefined {
  const paragraphs = paragraphsOf(parseFragment(html).body);
  if (!paragraphs[0]?.startsWith('Open to work')) return undefined;
  const [locationText, workplaceText] = (paragraphs[1] ?? '').split('|').map((part) => part.trim());
  const workplaceTypes = (workplaceText ?? '')
    .split('·')
    .map((part) => WORKPLACE_LABELS[part.trim().toLowerCase()])
    .filter((type): type is ParsedWorkplaceType => Boolean(type));
  const roles = (paragraphs[2] ?? '')
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  return { roles, locations: locationText ? [locationText] : [], workplaceTypes };
}

function readAchievementDateRange(text: string | undefined): { date?: string; endDate?: string } {
  if (!text) return {};
  const [start, end] = text.split(/\s[-–]\s/u).map((part) => part.trim());
  return { date: start, endDate: end === 'Present' ? undefined : end };
}

/** One achievement card (honor/publication/patent/organization/volunteering) into the shared shape. */
export function parseAchievementCard(
  html: string,
  kind: ParsedResumeAchievementKind,
): ParsedResumeAchievement | undefined {
  const doc = parseFragment(html);
  const anchor = doc.querySelector('a[href*="/edit/forms/"]');
  const ps = anchor ? paragraphsOf(anchor) : [];
  const description = textOf(doc.querySelector('[data-testid="expandable-text-box"]'));
  const url = Array.from(doc.querySelectorAll('a'))
    .map((a) => a.getAttribute('href') ?? undefined)
    .find((href) => href && /^https?:\/\//u.test(href) && !href.includes('linkedin.com'));
  if (kind === 'volunteering') {
    const [role, issuer, , dateRange] = ps;
    if (!role) return undefined;
    return { kind, title: role, issuer, description, url, ...readAchievementDateRange(dateRange) };
  }
  if (kind === 'organization') {
    const [title, role, dateRange] = ps;
    if (!title) return undefined;
    return { kind, title, role, description, url, ...readAchievementDateRange(dateRange) };
  }
  const [title, issuer, dateText] = ps;
  if (!title) return undefined;
  const date = dateText?.replace(/^(Issued|Published)\s+/u, '');
  return { kind, title, issuer, description, url, date };
}

export interface LinkedInProfilePages {
  readonly profile: string;
  readonly experience?: string;
  readonly education?: string;
  readonly certifications?: string;
  readonly projects?: string;
  readonly skills?: string;
  readonly contactInfo?: string;
  readonly recommendations?: string;
  readonly achievements?: readonly { readonly kind: ParsedResumeAchievementKind; readonly html: string }[];
  readonly openToWork?: string;
}

/**
 * Assembles `LinkedInProfileV2` from whichever pages were captured. Every
 * page is optional except the profile itself, so a partial capture still
 * yields a partial-but-honest result (no silent fabrication).
 */
export function extractStructuredLinkedInProfile(pages: LinkedInProfilePages): LinkedInProfileV2 {
  const topCard = parseTopCard(pages.profile);
  const contact = pages.contactInfo ? parseContactInfo(pages.contactInfo) : { links: [] };
  const base = emptyLinkedInProfileV2();
  return {
    ...base,
    fullName: topCard.fullName,
    headline: topCard.headline,
    photoSourceUrl: topCard.photoSourceUrl,
    contact: { ...base.contact, ...contact, location: topCard.location },
    experience: pages.experience ? parseExperienceSection(pages.experience) : [],
    education: pages.education ? parseEducationSection(pages.education) : [],
    certifications: pages.certifications ? parseCertificationsSection(pages.certifications) : [],
    projects: pages.projects ? parseProjectsSection(pages.projects) : [],
    skills: pages.skills ? parseSkillsSection(pages.skills) : [],
    recommendations: pages.recommendations ? parseRecommendationsSection(pages.recommendations) : [],
    languages: parseLanguagesSection(pages.profile),
    achievements: (pages.achievements ?? [])
      .map(({ kind, html }) => parseAchievementCard(html, kind))
      .filter((achievement): achievement is ParsedResumeAchievement => Boolean(achievement)),
    openToWork: parseOpenToWork(pages.profile),
  };
}
