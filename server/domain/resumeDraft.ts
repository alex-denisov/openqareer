import { z } from 'zod';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface ResumeCandidateInput {
  readonly fullName?: string;
  readonly photoUrl?: string;
  readonly about?: string;
  readonly contact?: {
    readonly email?: string;
    readonly phone?: string;
    readonly telegram?: string;
    readonly location?: string;
    readonly links?: readonly string[];
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
const longTextSchema = z.string().trim().max(10_000);
const urlSchema = z.string().trim().max(2_000);

export const resumeDraftSchema = z
  .object({
    candidate: z
      .object({
        fullName: labelSchema.optional(),
        photoUrl: urlSchema.optional(),
        about: longTextSchema.optional(),
        contact: z
          .object({
            email: z.string().trim().email().max(320).optional(),
            phone: z.string().trim().max(60).optional(),
            telegram: z.string().trim().max(100).optional(),
            location: labelSchema.optional(),
            links: z.array(z.string().trim().max(500)).max(20).default([]),
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
  })
  .strict();


