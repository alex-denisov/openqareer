/**
 * Structured LinkedIn extractor by markup anchors (B265 §2/§5, architecture.md
 * §1/§2). Each card gets its own function; `extractStructuredLinkedInProfile`
 * only assembles the pages the caller happened to capture. The text-based
 * `extractLinkedInProfile` (B264) stays untouched as the fallback path.
 */
import {
  isLinkedInProficiencyLabel,
  linkedInCefrForProficiency,
  type LinkedInProfileV2,
} from '../../../shared/linkedinProfileV2';
import type {
  ParsedResumeAchievement,
  ParsedResumeAchievementKind,
  ParsedResumeLanguage,
  ParsedResumeOpenToWork,
  ParsedWorkplaceType,
} from '../workspace/resumeParserTypes';
import { parseEducationSection, parseExperienceSection } from './linkedinExperienceExtract';
import { htmlToLines } from './linkedinProfileExtract';
import {
  parseCertificationsSection,
  parseCoursesSection,
  parseProjectsSection,
  parseRecommendationsSection,
  parseSkillsPage,
  type ParsedSkills,
} from './linkedinCredentialExtract';
import {
  decodeSafetyGoUrl,
  leafTextLines,
  mediaSourceUrl,
  paragraphsOf,
  parseFragment,
  textOf,
} from './linkedinDom';
import {
  sanitizeLinkedInProfileV2,
  validLinkedInProfileWithDrops,
} from './linkedinProfileSanitize';

/** Logged with the payload so a markup drift shows up server-side (architecture §2). */
export const LI_SDUI_EXTRACTOR_VERSION = 'li-sdui-1';

/** The "form" of ParsedResume v2 sent over the wire — no `rawText` (architecture §2). */
export type { LinkedInProfileV2 };

function emptyLinkedInProfileV2(): LinkedInProfileV2 {
  return {
    fullName: undefined,
    headline: undefined,
    photoSourceUrl: undefined,
    about: undefined,
    contact: { links: [] },
    experience: [],
    skills: [],
    education: [],
    courses: [],
    tests: [],
    recommendations: [],
    languages: [],
    certifications: [],
    projects: [],
    achievements: [],
    openToWork: undefined,
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
  return {
    fullName,
    headline,
    photoSourceUrl,
    location: location === headline ? undefined : location,
  };
}

const ABOUT_CARD_SELECTOR = '[componentkey^="com.linkedin.sdui.profile.card."][componentkey$="About"]';

/**
 * The summary lives in the About card's expandable text box; «…more» is only
 * visual, the full text is already in the DOM (B264 §6). The card is found by
 * its key, never by the word «About», which the page footer also carries.
 */
export function parseAboutSection(html: string): string | undefined {
  const card = parseFragment(html).querySelector(ABOUT_CARD_SELECTOR);
  const box = card?.querySelector('[data-testid="expandable-text-box"]');
  if (!box) return undefined;
  const clone = box.cloneNode(true) as Element;
  clone.querySelectorAll('[data-testid="expandable-text-button"]').forEach((node) => node.remove());
  clone.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  const lines = (clone.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Languages live on `profile.html`; the details page can render a false empty
 * state (B264 §6). Rows are «<language>» followed by «… proficiency»: read as
 * paragraphs first, then as leaf text lines — the live card does not always
 * use `<p>` (B266: the text importer saw the pair, this parser did not).
 */
export function parseLanguagesSection(html: string): ParsedResumeLanguage[] {
  const body = parseFragment(html).body;
  const readings = [() => paragraphsOf(body), () => htmlToLines(html), () => leafTextLines(body)];
  for (const read of readings) {
    const found = languagePairs(read());
    if (found.length > 0) return found;
  }
  return [];
}

function languagePairs(lines: readonly string[]): ParsedResumeLanguage[] {
  const languages: ParsedResumeLanguage[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const [name, label] = [lines[i], lines[i + 1]];
    const isHeading = /^languages?$/iu.test(name);
    if (
      !isLinkedInProficiencyLabel(label) ||
      isLinkedInProficiencyLabel(name) ||
      isHeading ||
      name.length > 40
    ) {
      continue;
    }
    if (!languages.some((language) => language.name === name)) {
      languages.push({ name, cefr: linkedInCefrForProficiency(label), sourceLabel: label });
    }
    i += 1;
  }
  return languages;
}


type ContactField = 'profile' | 'website' | 'phone' | 'email' | 'other';

// EN and RU interface labels (29.10: the overlay was only ever read in English).
const CONTACT_FIELD_LABELS: readonly (readonly [ContactField, RegExp])[] = [
  ['profile', /^(your profile|.+'s profile|ваш профиль|профиль(\s.*)?)$/iu],
  ['website', /^(websites?|веб-сайты?|сайты?)$/iu],
  ['phone', /^(phones?|телефоны?)$/iu],
  ['email', /^(e-?mail|эл\. адрес|электронная почта|адрес электронной почты)$/iu],
  [
    'other',
    /^(birthday|день рождения|address|адрес|im|instant messengers?|connected|связь установлена|contact info|контактная информация|контактные данные)$/iu,
  ],
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const LINKEDIN_PROFILE = /^(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com(\/in\/[^/?#\s]+)\/?$/iu;
const BARE_SITE = /^(?:https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/u;

interface ContactInfo {
  email?: string;
  phone?: string;
  telegram?: string;
  linkedinUrl?: string;
  links: string[];
}

interface ContactLine {
  readonly text: string;
  readonly href?: string;
}

/** Leaf texts in document order; a link counts as one line with its href. */
function contactLines(root: Element): ContactLine[] {
  return Array.from(root.querySelectorAll('*'))
    .filter((node) => node.matches('a') || (node.children.length === 0 && !node.closest('a')))
    .flatMap((node) => {
      const text = textOf(node);
      if (!text) return [];
      return [{ text, href: node.getAttribute('href') ?? undefined }];
    });
}

function contactField(text: string): ContactField | undefined {
  return CONTACT_FIELD_LABELS.find(([, label]) => label.test(text))?.[0];
}

function profileUrl(line: ContactLine): string | undefined {
  try {
    const path = line.href
      ? new URL(line.href, 'https://www.linkedin.com').pathname
      : LINKEDIN_PROFILE.exec(line.text)?.[1];
    const slug = path && /^\/in\/([^/]+)\/?$/u.exec(path)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug}/` : undefined;
  } catch {
    return undefined;
  }
}

function websiteUrl(line: ContactLine): string | undefined {
  if (line.href) return decodeSafetyGoUrl(line.href);
  if (!BARE_SITE.test(line.text)) return undefined;
  return /^https?:\/\//u.test(line.text) ? line.text : `https://${line.text}`;
}

/**
 * The contact-info overlay, read by its row labels in document order (B264,
 * 29.10): the DOM shape and the interface language both vary, the labels and
 * the order "label, then its values" do not. Birthday and unknown rows are
 * never read.
 */
export function parseContactInfo(html: string): ContactInfo {
  const lines = contactLines(parseFragment(html).body);
  let field: ContactField = 'other';
  let result: ContactInfo = { links: [] };
  const phone: string[] = [];
  for (const line of lines) {
    const label = line.href ? undefined : contactField(line.text);
    if (label) {
      field = label;
      continue;
    }
    if (field === 'profile')
      result = { ...result, linkedinUrl: result.linkedinUrl ?? profileUrl(line) };
    if (field === 'email' && EMAIL.test(line.text))
      result = { ...result, email: result.email ?? line.text };
    if (field === 'phone') phone.push(line.text);
    if (field === 'website') result = withWebsite(result, websiteUrl(line));
  }
  return phone.length > 0 ? { ...result, phone: phone.join(' ') } : result;
}

function withWebsite(result: ContactInfo, url: string | undefined): ContactInfo {
  if (!url) return result;
  if (/(^|\.)t\.me$/u.test(new URL(url).hostname)) return { ...result, telegram: url };
  return result.links.includes(url) ? result : { ...result, links: [...result.links, url] };
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
  readonly languages?: string;
  readonly courses?: string;
  readonly achievements?: readonly {
    readonly kind: ParsedResumeAchievementKind;
    readonly html: string;
  }[];
  readonly openToWork?: string;
}

/**
 * Assembles `LinkedInProfileV2` from whichever pages were captured. Every
 * page is optional except the profile itself, so a partial capture still
 * yields a partial-but-honest result (no silent fabrication).
 */
export function extractStructuredLinkedInProfile(pages: LinkedInProfilePages): LinkedInProfileV2 {
  return extractStructuredLinkedInProfileTolerant(pages).profile;
}

/** Runs one section parser; a throw is recorded by name and yields `empty`. */
function sectionReader(failedSections: string[]) {
  return function section<T>(name: string, read: () => T, empty: T): T {
    try {
      return read();
    } catch {
      failedSections.push(name);
      return empty;
    }
  };
}

export interface TolerantExtraction {
  readonly profile: LinkedInProfileV2;
  /** Sections whose parser threw on this markup; each one is left empty (B266). */
  readonly failedSections: readonly string[];
  /** Field paths (never values) dropped to pass linkedinProfileV2Schema (M2). */
  readonly droppedFields?: readonly string[];
}

/**
 * Same assembly, but one section's parser throwing on unfamiliar markup
 * empties that section only — the rest of the profile still goes through the
 * structured path instead of the text importer (B266).
 */
export function extractStructuredLinkedInProfileTolerant(
  pages: LinkedInProfilePages,
): TolerantExtraction {
  const failedSections: string[] = [];
  const section = sectionReader(failedSections);
  const topCard = section('topCard', () => parseTopCard(pages.profile), {} as TopCard);
  const contact = section(
    'contact',
    () => (pages.contactInfo ? parseContactInfo(pages.contactInfo) : { links: [] }),
    { links: [] as string[] },
  );
  const rawProfile = assembleRawSections(pages, section, topCard, contact);
  const valid = validLinkedInProfileWithDrops(rawProfile);
  const profile = valid ? valid.profile : sanitizeLinkedInProfileV2(rawProfile);
  const droppedFields = [
    ...failedSections.map((name) => `section:${name}`),
    ...(valid?.dropped ?? []),
  ];
  return { profile, failedSections, ...(droppedFields.length > 0 ? { droppedFields } : {}) };
}

function assembleRawSections(
  pages: LinkedInProfilePages,
  section: ReturnType<typeof sectionReader>,
  topCard: TopCard,
  contact: ReturnType<typeof parseContactInfo>,
): LinkedInProfileV2 {
  const base = emptyLinkedInProfileV2();
  const noSkills: ParsedSkills = { skills: [], assessed: [] };
  const skills = section(
    'skills',
    () => (pages.skills ? parseSkillsPage(pages.skills) : noSkills),
    noSkills,
  );
  return {
    ...base,
    fullName: topCard.fullName,
    headline: topCard.headline,
    photoSourceUrl: topCard.photoSourceUrl,
    about: section('about', () => parseAboutSection(pages.profile), undefined),
    contact: { ...base.contact, ...contact, location: topCard.location },
    experience: section('experience', () => (pages.experience ? parseExperienceSection(pages.experience) : []), []),
    education: section('education', () => firstNonEmpty(pages.education, pages.profile, parseEducationSection), []),
    certifications: section(
      'certifications',
      () => firstNonEmpty(pages.certifications, pages.profile, parseCertificationsSection),
      [],
    ),
    projects: section('projects', () => (pages.projects ? parseProjectsSection(pages.projects) : []), []),
    skills: skills.skills,
    skillAssessments: skills.assessed,
    recommendations: section(
      'recommendations',
      () => (pages.recommendations ? parseRecommendationsSection(pages.recommendations) : []),
      [],
    ),
    courses: section('courses', () => firstNonEmpty(pages.courses, pages.profile, parseCoursesSection), []),
    languages: section('languages', () => firstNonEmpty(pages.languages, pages.profile, parseLanguagesSection), []),
    achievements: section(
      'achievements',
      () =>
        (pages.achievements ?? [])
          .map(({ kind, html }) => parseAchievementCard(html, kind))
          .filter((achievement): achievement is ParsedResumeAchievement => Boolean(achievement)),
      [],
    ),
    openToWork: section('openToWork', () => parseOpenToWork(pages.profile), undefined),
  };
}

/**
 * A details page LinkedIn renders lazily can come back empty; a short section
 * (a few schools, two languages) then lives only on the main profile (B266).
 */
function firstNonEmpty<T>(
  detailsHtml: string | undefined,
  profileHtml: string,
  parse: (html: string) => T[],
): T[] {
  const fromDetails = detailsHtml ? parse(detailsHtml) : [];
  return fromDetails.length > 0 ? fromDetails : parse(profileHtml);
}
