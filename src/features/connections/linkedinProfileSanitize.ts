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
