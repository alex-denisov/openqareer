/**
 * Field-level sanitiser for `LinkedInProfileV2` (B266 §2, M2 cases 22-23).
 * `linkedinProfileV2Schema.strict()` fails the *whole* payload the moment one
 * item is out of shape — one malformed experience entry would otherwise sink
 * every other section too. This walks each field independently, drops what
 * does not pass, and always hands back a payload the schema accepts whole.
 */
import {
  achievementSchema,
  certificationSchema,
  courseSchema,
  educationSchema,
  experienceSchema,
  languageSchema,
  linkedinProfileV2Schema,
  openToWorkSchema,
  projectSchema,
  recommendationSchema,
  testSchema,
  type LinkedInProfileV2,
} from '../../../shared/linkedinProfileV2';
import { z, type ZodTypeAny } from 'zod';

function keepValid<T extends ZodTypeAny>(schema: T, items: readonly unknown[]): z.infer<T>[] {
  return items
    .map((item) => schema.safeParse(item))
    .filter((result): result is { success: true; data: z.infer<T> } => result.success)
    .map((result) => result.data);
}

function keepValidScalar<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

const captionSchema = z.string().trim().min(1).max(300);

/**
 * Sanitises a candidate structured profile field by field. The result is
 * always accepted whole by `linkedinProfileV2Schema` (verified by the caller
 * in `linkedinSessionPoll.ts` before the payload ever leaves the device).
 */
export function sanitizeLinkedInProfileV2(profile: LinkedInProfileV2): LinkedInProfileV2 {
  const contactLinks = keepValid(z.string().trim().max(2_000).url(), profile.contact.links);
  return {
    ...profile,
    fullName: keepValidScalar(captionSchema, profile.fullName),
    targetRole: keepValidScalar(captionSchema, profile.targetRole),
    headline: keepValidScalar(captionSchema, profile.headline),
    photoSourceUrl: keepValidScalar(
      z.string().trim().max(2_000).url(),
      profile.photoSourceUrl,
    ),
    about: keepValidScalar(z.string().trim().max(10_000), profile.about),
    contact: { ...profile.contact, links: contactLinks },
    experience: keepValid(experienceSchema, profile.experience),
    skills: keepValid(captionSchema, profile.skills),
    education: keepValid(educationSchema, profile.education),
    courses: keepValid(courseSchema, profile.courses),
    tests: keepValid(testSchema, profile.tests),
    recommendations: keepValid(recommendationSchema, profile.recommendations),
    languages: keepValid(languageSchema, profile.languages),
    certifications: profile.certifications
      ? keepValid(certificationSchema, profile.certifications)
      : undefined,
    projects: profile.projects ? keepValid(projectSchema, profile.projects) : undefined,
    achievements: profile.achievements
      ? keepValid(achievementSchema, profile.achievements)
      : undefined,
    openToWork: profile.openToWork
      ? keepValidScalar(openToWorkSchema, profile.openToWork)
      : undefined,
  };
}

/**
 * `true` once at least one section carries a real fact — mirrors the server's
 * own `carriesProfileSubstance` check so an empty structured capture falls
 * back to the text extractor instead of committing nothing.
 */
export function hasStructuredSubstance(profile: LinkedInProfileV2): boolean {
  return (
    profile.experience.length > 0 ||
    profile.education.length > 0 ||
    profile.skills.length > 0 ||
    (profile.about?.length ?? 0) > 0 ||
    Boolean(profile.fullName)
  );
}

/** Validates the sanitised profile is schema-clean before it leaves the device. */
export function sanitizedAndValidLinkedInProfile(
  profile: LinkedInProfileV2,
): LinkedInProfileV2 | undefined {
  const sanitized = sanitizeLinkedInProfileV2(profile);
  const result = linkedinProfileV2Schema.safeParse(sanitized);
  return result.success ? result.data : undefined;
}

/** The list ceilings of `linkedinProfileV2Schema`; sanitising trims to them. */
const LIST_CEILINGS = {
  experience: 50,
  skills: 100,
  education: 30,
  courses: 50,
  tests: 50,
  recommendations: 50,
  languages: 30,
  certifications: 50,
  projects: 50,
  achievements: 100,
} as const;
const CONTACT_LINKS_CEILING = 20;
const MAX_REPAIR_PASSES = 10;

export interface ValidLinkedInProfile {
  readonly profile: LinkedInProfileV2;
  /** Field paths removed to pass the schema — paths only, never values (B266). */
  readonly dropped: readonly string[];
}

function trimToCeilings(profile: LinkedInProfileV2): ValidLinkedInProfile {
  const dropped: string[] = [];
  const trimmed = Object.entries(LIST_CEILINGS).reduce<LinkedInProfileV2>((acc, [key, ceiling]) => {
    const list = acc[key as keyof typeof LIST_CEILINGS] as readonly unknown[] | undefined;
    if (!list || list.length <= ceiling) return acc;
    dropped.push(key);
    return { ...acc, [key]: list.slice(0, ceiling) };
  }, profile);
  if (trimmed.contact.links.length <= CONTACT_LINKS_CEILING) return { profile: trimmed, dropped };
  dropped.push('contact.links');
  return {
    profile: { ...trimmed, contact: { ...trimmed.contact, links: trimmed.contact.links.slice(0, CONTACT_LINKS_CEILING) } },
    dropped,
  };
}

/** Removes what one schema issue points at: a list item, or else the field itself. */
function withoutIssuePath(value: unknown, path: readonly PropertyKey[]): unknown {
  const [head, ...rest] = path;
  if (head === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return typeof head === 'number' ? value.filter((_, index) => index !== head) : value;
  }
  const record = value as Record<PropertyKey, unknown>;
  const child = record[head];
  const isListItem = Array.isArray(child) && typeof rest[0] === 'number';
  if (rest.length === 0 || (!isListItem && (child === null || typeof child !== 'object'))) {
    const { [head]: _removed, ...kept } = record;
    return kept;
  }
  return { ...record, [head]: isListItem ? child.filter((_, index) => index !== rest[0]) : withoutIssuePath(child, rest) };
}

function describePath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === 'number' ? '[]' : String(part)))
    .join('.')
    .replace(/\.\[\]/gu, '[]')
    .slice(0, 120);
}

/**
 * Sanitises, trims lists to the schema ceilings, then — should the schema
 * still refuse — removes exactly what each issue names and tries again. One
 * odd field must never send a LinkedIn import down the text path, which
 * mangles experience (B266: «· 11 mos» as a job title).
 */
export function validLinkedInProfileWithDrops(
  profile: LinkedInProfileV2,
): ValidLinkedInProfile | undefined {
  const start = trimToCeilings(sanitizeLinkedInProfileV2(profile));
  let candidate: unknown = start.profile;
  const dropped = [...start.dropped];
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const result = linkedinProfileV2Schema.safeParse(candidate);
    if (result.success) return { profile: result.data, dropped };
    const issue = result.error.issues[0];
    if (!issue || issue.path.length === 0) return undefined;
    dropped.push(describePath(issue.path));
    candidate = withoutIssuePath(candidate, issue.path);
  }
  return undefined;
}
