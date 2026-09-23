/**
 * Experience and Education cards (B265 §2, architecture.md §1/§2; anatomy in
 * docs/v1-release/tasks/work/B264/linkedin-profile-structure.md §2).
 */
import type {
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedWorkplaceType,
} from '../workspace/resumeParserTypes';
import { mediaSourceUrl, parseFragment, textOf } from './linkedinDom';

const WORKPLACE_TYPES: Readonly<Record<string, ParsedWorkplaceType>> = {
  'on-site': 'on_site',
  hybrid: 'hybrid',
  remote: 'remote',
};

function workplaceTypeOf(text: string | undefined): ParsedWorkplaceType | undefined {
  if (!text) return undefined;
  const last = text.split('·').at(-1)?.trim().toLowerCase();
  return last ? WORKPLACE_TYPES[last] : undefined;
}

function splitDateRange(text: string | undefined): { start?: string; end?: string; current: boolean } {
  if (!text) return { current: false };
  const withoutDuration = text.split('·')[0]?.trim() ?? text;
  const [start, end] = withoutDuration.split(/\s[-–]\s/u).map((part) => part.trim());
  return { start, end: end === 'Present' ? undefined : end, current: end === 'Present' };
}

function skillsFromAssociationLink(item: Element): string[] | undefined {
  const link = item.querySelector('a[href*="skill-associations-details"]');
  const text = textOf(link);
  if (!text) return undefined;
  const named = text.replace(/\s+and\s+\+\d+\s+skills?$/iu, '');
  const skills = named
    .split(',')
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0 && !/^\+\d+ skills?$/iu.test(skill));
  return skills.length > 0 ? skills : undefined;
}

function readItemAnchorParagraphs(anchor: Element): string[] {
  return Array.from(anchor.querySelectorAll(':scope p'))
    .map((p) => textOf(p))
    .filter((text): text is string => Boolean(text));
}

function readOneExperience(anchor: Element): ParsedResumeExperience | undefined {
  const item = anchor.closest('[componentkey]');
  if (!item) return undefined;
  const groupParent = item.parentElement?.getAttribute('componentkey')?.startsWith('entity-collection-item')
    ? item.parentElement
    : undefined;
  const [title, subtitle, dates, location] = readItemAnchorParagraphs(anchor);
  if (!title) return undefined;
  const employer = groupParent ? textOf(groupParent.querySelector('p')) : subtitle?.split('·')[0]?.trim();
  const employmentType = groupParent ? subtitle : subtitle?.split('·')[1]?.trim();
  const { start, end, current } = splitDateRange(dates);
  const description = textOf(item.querySelector('[data-testid="expandable-text-box"]'));
  const responsibilities = description
    ? description
        .split(/[•\n]/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
  return {
    title,
    employer: employer ?? 'Unknown',
    location: location?.split('·')[0]?.trim(),
    startDate: start,
    endDate: end,
    current,
    responsibilities,
    achievements: [],
    employmentType,
    workplaceType: workplaceTypeOf(location),
    skills: skillsFromAssociationLink(item),
    employerLogoSourceUrl: mediaSourceUrl(item.querySelector('img')?.getAttribute('src')),
    employerGroupKey: groupParent?.getAttribute('componentkey') ?? undefined,
  };
}

/** Reads every experience role from an `experience.html`-shaped snapshot. */
export function parseExperienceSection(html: string): ParsedResumeExperience[] {
  const doc = parseFragment(html);
  const anchors = Array.from(doc.querySelectorAll('a[href*="/details/experience/edit/forms/"]'));
  return anchors
    .map((anchor) => readOneExperience(anchor))
    .filter((role): role is ParsedResumeExperience => Boolean(role));
}

function readOneEducation(anchor: Element): ParsedResumeEducation | undefined {
  const item = anchor.closest('[componentkey]');
  const ps = readItemAnchorParagraphs(anchor);
  const [institution, qualification, dates] = ps;
  if (!institution) return undefined;
  const { start, end } = splitDateRange(dates);
  return {
    institution,
    qualification,
    startDate: start,
    endDate: end,
    description: textOf(item?.querySelector('[data-testid="expandable-text-box"]')),
  };
}

/** Reads every entry from an `education.html`-shaped snapshot. */
export function parseEducationSection(html: string): ParsedResumeEducation[] {
  const doc = parseFragment(html);
  const anchors = Array.from(doc.querySelectorAll('a[href*="/details/education/edit/forms/"]'));
  return anchors
    .map((anchor) => readOneEducation(anchor))
    .filter((entry): entry is ParsedResumeEducation => Boolean(entry));
}
