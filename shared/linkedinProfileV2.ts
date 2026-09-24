import { z } from 'zod';

/**
 * The structured LinkedIn profile contract (B265 §2). One schema, imported by
 * both the `.app` extractor (self-check before it ever sends a request) and
 * the server (the only validation that actually matters, since a client is
 * never trusted). Every field here mirrors `ParsedResume`'s v2 additions
 * (`src/features/workspace/resumeParserTypes.ts`); this file exists so both
 * sides of the wire can import the same type without the server pulling in
 * `src/` internals or the client pulling in server domain types.
 *
 * No `birthday` field exists here on purpose (owner decision, tickets/B265
 * §3a) — the extractor discards it at the source, and the server has nowhere
 * to put it even if a payload tried to carry it.
 */

const CAPTION_MAX = 300;
const LONG_TEXT_MAX = 10_000;
const DESCRIPTION_MAX = 5_000;
const RECOMMENDATION_TEXT_MAX = 5_000;
const URL_MAX = 2_000;

const caption = z.string().trim().min(1).max(CAPTION_MAX);
const optionalCaption = z.string().trim().max(CAPTION_MAX).optional();
const optionalDate = z.string().trim().max(30).optional();
const longText = z.string().trim().max(LONG_TEXT_MAX).optional();
const description = z.string().trim().max(DESCRIPTION_MAX).optional();

/** Any `https:` URL — used for generic profile links, not LinkedIn media. */
const httpsUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Only https URLs are accepted.',
  });

/**
 * A LinkedIn media source URL: `https://media.licdn.com/dms/image/...`. This
 * is the same host/path restriction the server-side downloader enforces
 * before ever calling `fetch` (`server/domain/candidateMedia.ts`) — checking
 * it again here, at the boundary of the contract itself, means a malformed
 * or hostile URL is rejected as a schema violation, not just skipped by the
 * downloader later (defence in depth, architecture §2).
 */
const licdnMediaUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .url()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          url.hostname === 'media.licdn.com' &&
          url.pathname.startsWith('/dms/image/')
        );
      } catch {
        return false;
      }
    },
    { message: 'Media links must be https://media.licdn.com/dms/image/...' },
  );

/**
 * A generic profile link, already decoded by the front-end extractor (the
 * `linkedin.com/safety/go/?url=` redirector never belongs on the wire — its
 * presence here means the client sent unprocessed raw markup).
 */
const profileLink = httpsUrl.refine(
  (value) => {
    const url = new URL(value);
    return !(
      (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) &&
      url.pathname.startsWith('/safety/go')
    );
  },
  { message: 'contact.links must not point at an un-decoded linkedin.com/safety/go redirector.' },
);

export const workplaceTypeSchema = z.enum(['on_site', 'hybrid', 'remote']);

export const cefrLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const experienceSchema = z
  .object({
    title: optionalCaption,
    employer: optionalCaption,
    location: optionalCaption,
    startDate: optionalDate,
    endDate: optionalDate,
    current: z.boolean(),
    responsibilities: z.array(z.string().trim().max(LONG_TEXT_MAX)).max(20).default([]),
    achievements: z.array(z.string().trim().max(LONG_TEXT_MAX)).max(20).default([]),
    employmentType: optionalCaption,
    workplaceType: workplaceTypeSchema.optional(),
    skills: z.array(caption).max(50).optional(),
    employerLogoSourceUrl: licdnMediaUrl.optional(),
    employerGroupKey: optionalCaption,
  })
  .strict();

export const educationSchema = z
  .object({
    institution: optionalCaption,
    qualification: optionalCaption,
    startDate: optionalDate,
    endDate: optionalDate,
    description: description,
  })
  .strict();

export const certificationSchema = z
  .object({
    name: caption,
    issuer: optionalCaption,
    issuedAt: optionalDate,
    expiresAt: optionalDate,
    credentialId: optionalCaption,
    url: httpsUrl.optional(),
  })
  .strict();

export const projectSchema = z
  .object({
    name: caption,
    startDate: optionalDate,
    endDate: optionalDate,
    current: z.boolean().optional(),
    description: description,
    employer: optionalCaption,
    url: httpsUrl.optional(),
    skills: z.array(caption).max(50).optional(),
  })
  .strict();

export const achievementKindSchema = z.enum([
  'honor',
  'publication',
  'patent',
  'organization',
  'volunteering',
]);

export const achievementSchema = z
  .object({
    kind: achievementKindSchema,
    title: caption,
    issuer: optionalCaption,
    role: optionalCaption,
    date: optionalDate,
    endDate: optionalDate,
    description: description,
    url: httpsUrl.optional(),
  })
  .strict();

export const courseSchema = z
  .object({
    name: caption,
    institution: optionalCaption,
    year: optionalDate,
    certificateUrl: httpsUrl.optional(),
  })
  .strict();

export const testSchema = z
  .object({
    name: caption,
    provider: optionalCaption,
    score: optionalCaption,
    year: optionalDate,
  })
  .strict();

export const recommendationSchema = z
  .object({
    recommender: optionalCaption,
    organization: optionalCaption,
    position: optionalCaption,
    text: z.string().trim().max(RECOMMENDATION_TEXT_MAX).optional(),
    contact: optionalCaption,
    relationship: optionalCaption,
    date: optionalDate,
  })
  .strict();

export const languageSchema = z
  .object({
    name: caption,
    cefr: cefrLevelSchema.optional(),
  })
  .strict();

export const openToWorkSchema = z
  .object({
    roles: z.array(caption).max(20),
    locations: z.array(caption).max(20),
    workplaceTypes: z.array(workplaceTypeSchema).max(3),
  })
  .strict();

/**
 * The full structured profile payload. Deliberately has no `rawText` and no
 * `birthday`-shaped field anywhere: an old client sending either fails schema
 * validation as an unknown field, rather than being silently ignored server
 * side (QA spec slice 3 #13).
 */
export const linkedinProfileV2Schema = z
  .object({
    fullName: optionalCaption,
    targetRole: optionalCaption,
    headline: optionalCaption,
    photoSourceUrl: licdnMediaUrl.optional(),
    about: longText,
    contact: z
      .object({
        email: z.string().trim().email().max(320).optional(),
        phone: z.string().trim().max(60).optional(),
        telegram: z.string().trim().max(100).optional(),
        location: optionalCaption,
        links: z.array(profileLink).max(20).default([]),
        linkedinUrl: httpsUrl.optional(),
      })
      .strict()
      .default({ links: [] }),
    experience: z.array(experienceSchema).max(50).default([]),
    skills: z.array(caption).max(100).default([]),
    education: z.array(educationSchema).max(30).default([]),
    courses: z.array(courseSchema).max(50).default([]),
    tests: z.array(testSchema).max(50).default([]),
    recommendations: z.array(recommendationSchema).max(50).default([]),
    languages: z.array(languageSchema).max(30).default([]),
    additional: z
      .object({
        citizenship: optionalCaption,
        workSchedule: optionalCaption,
        relocation: optionalCaption,
        driversLicense: optionalCaption,
      })
      .strict()
      .optional(),
    certifications: z.array(certificationSchema).max(50).optional(),
    projects: z.array(projectSchema).max(50).optional(),
    achievements: z.array(achievementSchema).max(100).optional(),
    openToWork: openToWorkSchema.optional(),
  })
  .strict();

export type LinkedInProfileV2 = z.infer<typeof linkedinProfileV2Schema>;
