import { z } from 'zod';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Format the candidate accepted for LinkedIn's remote/on-site/hybrid label. */
export type WorkplaceType = 'on_site' | 'hybrid' | 'remote';

export interface ResumeCandidateInput {
  readonly fullName?: string;
  readonly photoUrl?: string;
  /** v2: candidate headline, distinct from any verification-badge text. */
  readonly headline?: string;
  /**
   * v2: a cached-media reference, separate from the manually edited
   * `photoUrl`. Points at `candidate_media` once slice 2 exists; nobody
   * writes it yet.
   */
  readonly photoMediaId?: string;
  readonly about?: string;
  readonly contact?: {
    readonly email?: string;
    readonly phone?: string;
    readonly telegram?: string;
    readonly location?: string;
    readonly links?: readonly string[];
    /** v2 */
    readonly linkedinUrl?: string;
  };
}

export interface ResumeExperienceInput {
  readonly id: string;
  readonly chronologyMemoryId: string;
  readonly title?: string;
  readonly employer?: string;
  readonly location?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly current: boolean;
  readonly bulletMemoryIds: readonly string[];
  /** v2 */
  readonly employmentType?: string;
  /** v2 */
  readonly workplaceType?: WorkplaceType;
  /** v2 */
  readonly skills?: readonly string[];
  /** v2: a cached-media reference for the employer logo (slice 2). */
  readonly employerLogoMediaId?: string;
  /** v2: groups several roles held at the same employer. */
  readonly employerGroupKey?: string;
}

export interface ResumeCertificationInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly name: string;
  readonly issuer?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly credentialId?: string;
  readonly url?: string;
}

export interface ResumeProjectInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly name: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly current?: boolean;
  readonly description?: string;
  readonly employer?: string;
  readonly url?: string;
  readonly skills?: readonly string[];
}

export type ResumeAchievementKind =
  | 'honor'
  | 'publication'
  | 'patent'
  | 'organization'
  | 'volunteering';

export interface ResumeAchievementInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly kind: ResumeAchievementKind;
  readonly title: string;
  readonly issuer?: string;
  readonly role?: string;
  readonly date?: string;
  readonly endDate?: string;
  readonly description?: string;
  readonly url?: string;
}

/**
 * A proposal read from a native source, never written directly to the
 * candidate's work preferences. Owner decision (tickets/B265 §3c): only ever
 * a suggestion the candidate accepts, changes or declines on screen.
 */
export interface ResumeSourceSuggestionsInput {
  readonly openToWork?: {
    readonly roles: readonly string[];
    readonly locations: readonly string[];
    readonly workplaceTypes: readonly WorkplaceType[];
  };
}

export interface ResumeSkillInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly name: string;
  readonly level?: string;
}

export interface ResumeEducationInput {
  readonly id: string;
  readonly evidenceMemoryId: string;
  readonly institution?: string;
  readonly qualification?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  /** v2 */
  readonly description?: string;
}

export interface ResumeCourseInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly name: string;
  readonly provider?: string;
  readonly institution?: string;
  readonly year?: string | number;
  readonly certificateUrl?: string;
}

export interface ResumeTestInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly name: string;
  readonly provider?: string;
  readonly score?: string;
  readonly year?: string | number;
}

export interface ResumeRecommendationInput {
  readonly id: string;
  readonly evidenceMemoryId?: string;
  readonly recommender?: string;
  readonly author?: string;
  readonly organization?: string;
  readonly role?: string;
  readonly position?: string;
  readonly text?: string;
  readonly contact?: string;
  /** v2 */
  readonly relationship?: string;
  /** v2 */
  readonly date?: string;
}

export interface ResumeLanguageInput {
  readonly id: string;
  readonly evidenceMemoryId: string;
  readonly name?: string;
  readonly cefr?: CefrLevel;
}

export interface ResumeAdditionalInput {
  readonly citizenship?: string;
  readonly workSchedule?: string;
  readonly relocation?: string;
  readonly driversLicense?: string;
}

/**
 * Candidate-entered resume material. Evidence is never part of the draft: a
 * claim may only enter a document through a confirmed dossier memory id.
 */
export interface ResumeDraft {
  /**
   * Present only on drafts written by v2-aware code. Absent (`undefined`) on
   * every existing v1 draft — reading one must not require a migration.
   */
  readonly schemaVersion?: 2;
  readonly candidate: ResumeCandidateInput;
  readonly targetRole?: string;
  readonly experience: readonly ResumeExperienceInput[];
  readonly skills?: readonly ResumeSkillInput[];
  readonly education: readonly ResumeEducationInput[];
  readonly courses?: readonly ResumeCourseInput[];
  readonly tests?: readonly ResumeTestInput[];
  readonly recommendations?: readonly ResumeRecommendationInput[];
  readonly languages: readonly ResumeLanguageInput[];
  readonly additional?: ResumeAdditionalInput;
  /** v2 */
  readonly certifications?: readonly ResumeCertificationInput[];
  /** v2 */
  readonly projects?: readonly ResumeProjectInput[];
  /** v2 */
  readonly achievements?: readonly ResumeAchievementInput[];
  /** v2: proposed from a native source, not applied until the candidate acts. */
  readonly sourceSuggestions?: ResumeSourceSuggestionsInput;
}

export const EMPTY_RESUME_DRAFT: ResumeDraft = {
  candidate: {},
  experience: [],
  skills: [],
  education: [],
  courses: [],
  tests: [],
  recommendations: [],
  languages: [],
};

const entryIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
const memoryIdSchema = z.string().trim().min(1).max(80);
const chronologyDateSchema = z.string().trim().max(30);
const labelSchema = z.string().trim().max(300);

// Anything outside \t (0x09), \n (0x0A) and \r (0x0D) among the C0/DEL
// controls. About/description paragraphs use \n\n and bullet lines with
// `• `, so those three stay allowed; everything else in that range never
// belongs in candidate-entered text (architecture §1, QA spec case 5).
// eslint-disable-next-line no-control-regex -- detecting control characters is the point of this pattern
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function withoutControlCharacters<Schema extends z.ZodString>(schema: Schema) {
  return schema.refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: 'Текст содержит недопустимые управляющие символы.',
  });
}

const longTextSchema = withoutControlCharacters(z.string().trim().max(10_000));
const descriptionSchema = withoutControlCharacters(z.string().trim().max(5_000));
// M4 hardening: a resume URL is only ever rendered as an outbound link, so it
// must be https — javascript:/data:/http: schemes never reach the browser.
const urlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Ссылка должна начинаться с https://.' },
  );
const workplaceTypeSchema = z.enum(['on_site', 'hybrid', 'remote']);
const skillListSchema = z.array(labelSchema).max(50);
const mediaIdSchema = z.string().trim().min(1).max(80);

export const resumeDraftSchema = z
  .object({
    schemaVersion: z.literal(2).optional(),
    candidate: z
      .object({
        fullName: labelSchema.optional(),
        photoUrl: urlSchema.optional(),
        headline: labelSchema.optional(),
        photoMediaId: mediaIdSchema.optional(),
        about: longTextSchema.optional(),
        contact: z
          .object({
            email: z.string().trim().email().max(320).optional(),
            phone: z.string().trim().max(60).optional(),
            telegram: z.string().trim().max(100).optional(),
            location: labelSchema.optional(),
            links: z.array(z.string().trim().max(500)).max(20).default([]),
            linkedinUrl: urlSchema.optional(),
          })
          .strict()
          .default({ links: [] }),
      })
      .strict()
      .default({ contact: { links: [] } }),
    targetRole: labelSchema.optional(),
    experience: z
      .array(
        z
          .object({
            id: entryIdSchema,
            chronologyMemoryId: memoryIdSchema,
            title: labelSchema.optional(),
            employer: labelSchema.optional(),
            location: labelSchema.optional(),
            startDate: chronologyDateSchema.optional(),
            endDate: chronologyDateSchema.optional(),
            current: z.boolean(),
            bulletMemoryIds: z.array(memoryIdSchema).max(20),
            employmentType: labelSchema.optional(),
            workplaceType: workplaceTypeSchema.optional(),
            skills: skillListSchema.optional(),
            employerLogoMediaId: mediaIdSchema.optional(),
            employerGroupKey: labelSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    skills: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            name: labelSchema,
            level: labelSchema.optional(),
          })
          .strict(),
      )
      .max(100)
      .optional()
      .default([]),
    education: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema,
            institution: labelSchema.optional(),
            qualification: labelSchema.optional(),
            startDate: chronologyDateSchema.optional(),
            endDate: chronologyDateSchema.optional(),
            description: descriptionSchema.optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    courses: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            name: labelSchema,
            provider: labelSchema.optional(),
            institution: labelSchema.optional(),
            year: z.union([chronologyDateSchema, z.number()]).optional(),
            certificateUrl: urlSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional()
      .default([]),
    tests: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            name: labelSchema,
            provider: labelSchema.optional(),
            score: labelSchema.optional(),
            year: z.union([chronologyDateSchema, z.number()]).optional(),
          })
          .strict(),
      )
      .max(50)
      .optional()
      .default([]),
    recommendations: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            recommender: labelSchema.optional(),
            author: labelSchema.optional(),
            organization: labelSchema.optional(),
            role: labelSchema.optional(),
            position: labelSchema.optional(),
            text: longTextSchema.optional(),
            contact: labelSchema.optional(),
            relationship: labelSchema.optional(),
            date: chronologyDateSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional()
      .default([]),
    languages: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema,
            name: labelSchema.optional(),
            cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    additional: z
      .object({
        citizenship: labelSchema.optional(),
        workSchedule: labelSchema.optional(),
        relocation: labelSchema.optional(),
        driversLicense: labelSchema.optional(),
      })
      .strict()
      .optional(),
    certifications: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            name: labelSchema,
            issuer: labelSchema.optional(),
            issuedAt: chronologyDateSchema.optional(),
            expiresAt: chronologyDateSchema.optional(),
            credentialId: labelSchema.optional(),
            url: urlSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    projects: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            name: labelSchema,
            startDate: chronologyDateSchema.optional(),
            endDate: chronologyDateSchema.optional(),
            current: z.boolean().optional(),
            description: descriptionSchema.optional(),
            employer: labelSchema.optional(),
            url: urlSchema.optional(),
            skills: skillListSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    achievements: z
      .array(
        z
          .object({
            id: entryIdSchema,
            evidenceMemoryId: memoryIdSchema.optional(),
            kind: z.enum(['honor', 'publication', 'patent', 'organization', 'volunteering']),
            title: labelSchema,
            issuer: labelSchema.optional(),
            role: labelSchema.optional(),
            date: chronologyDateSchema.optional(),
            endDate: chronologyDateSchema.optional(),
            description: descriptionSchema.optional(),
            url: urlSchema.optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    // Owner decision (ticket §3c): a native source's open-to-work signal is
    // only ever a proposal. It is sealed with the draft; accepting it goes
    // through the existing work-preferences route, never written here.
    sourceSuggestions: z
      .object({
        openToWork: z
          .object({
            roles: z.array(labelSchema).max(20),
            locations: z.array(labelSchema).max(20),
            workplaceTypes: z.array(workplaceTypeSchema).max(3),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();


