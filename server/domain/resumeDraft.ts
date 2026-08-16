import { z } from 'zod';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface ResumeCandidateInput {
  readonly fullName?: string;
  readonly contact?: {
    readonly email?: string;
    readonly phone?: string;
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

export interface ResumeEducationInput {
  readonly id: string;
  readonly evidenceMemoryId: string;
  readonly institution?: string;
  readonly qualification?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface ResumeLanguageInput {
  readonly id: string;
  readonly evidenceMemoryId: string;
  readonly name?: string;
  readonly cefr?: CefrLevel;
}

/**
 * Candidate-entered resume material. Evidence is never part of the draft: a
 * claim may only enter a document through a confirmed dossier memory id.
 */
export interface ResumeDraft {
  readonly candidate: ResumeCandidateInput;
  readonly targetRole?: string;
  readonly experience: readonly ResumeExperienceInput[];
  readonly education: readonly ResumeEducationInput[];
  readonly languages: readonly ResumeLanguageInput[];
}

export const EMPTY_RESUME_DRAFT: ResumeDraft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
};

const entryIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
const memoryIdSchema = z.string().trim().min(1).max(80);
const chronologyDateSchema = z.string().trim().max(20);
const labelSchema = z.string().trim().max(200);

/**
 * Strict by design: photo, birth date/place, marital status, religion and any
 * other unlisted demographic field are rejected at the boundary rather than
 * silently stored.
 */
export const resumeDraftSchema = z
  .object({
    candidate: z
      .object({
        fullName: labelSchema.optional(),
        contact: z
          .object({
            email: z.string().trim().email().max(320).optional(),
            phone: z.string().trim().max(40).optional(),
            location: labelSchema.optional(),
            links: z.array(z.string().trim().url().max(400)).max(10).default([]),
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
            bulletMemoryIds: z.array(memoryIdSchema).max(12),
          })
          .strict(),
      )
      .max(30)
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
      .max(20)
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
      .max(20)
      .default([]),
  })
  .strict();

