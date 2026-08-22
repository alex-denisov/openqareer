import { z } from 'zod';
import {
  getEmailError,
  getNameError,
  getPasswordError,
} from '../../shared/accountValidation';
import { parseProfileUrl } from '../connectors/profileUrlImport';
import { hhApplicationExecutionTargetSchema } from '../orchestration/careerCommandPlanner';

function fieldGovernedBy(check: (value: string) => string | null, trim: boolean) {
  const base = trim ? z.string().trim() : z.string();
  return base.superRefine((value, ctx) => {
    const message = check(value);
    if (message !== null) ctx.addIssue({ code: 'custom', message });
  });
}

const passwordField = fieldGovernedBy(getPasswordError, false);

export const registrationSchema = z.object({
  displayName: fieldGovernedBy(getNameError, true),
  email: fieldGovernedBy(getEmailError, true),
  password: passwordField,
});

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

/**
 * B139: no login field. The candidate gives a name, an address and a password;
 * the account handle is derived. Every rule carries the message the form shows
 * next to the offending field, so a rejection can never collapse into one
 * anonymous "проверьте формат и длину переданных данных".
 *
 * The message comes from the shared rule itself rather than being fixed per
 * field: a 300-character password must not be answered with "сделайте длиннее".
 */
export const accountProfileSchema = z
  .object({
    email: z.string().trim().email().max(254).nullable().optional(),
    displayName: z.string().trim().min(2).max(120).nullable().optional(),
    headline: z.string().trim().min(2).max(220).nullable().optional(),
    location: z.string().trim().min(2).max(160).nullable().optional(),
    workMode: z.enum(['office', 'hybrid', 'remote', 'flexible']).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one profile field is required',
  });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: passwordField,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'new password must be different',
  });

export const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
});

export const passwordResetSchema = z.object({
  token: z.string().regex(/^oqr_[A-Za-z0-9_-]{40,}$/),
  newPassword: passwordField,
});

function hasUnsafeFileNameCharacter(value: string): boolean {
  return [...value].some(
    (character) => character === '/' || character === '\\' || character.charCodeAt(0) < 32,
  );
}

export const candidateCreateSchema = z.object({
  dataClass: z.enum(['synthetic', 'personal']).default('personal'),
  locale: z.enum(['ru-RU', 'en-US']).default('ru-RU'),
});

export const candidateDocumentSchema = z.object({
  kind: z.enum(['resume', 'cover_letter', 'certificate', 'portfolio', 'profile_export', 'other']),
  source: z.enum(['upload', 'generated', 'import']),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => !hasUnsafeFileNameCharacter(value)),
  mimeType: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/json',
  ]),
  contentBase64: z
    .string()
    .min(4)
    .max(7_100_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  extractedText: z.string().trim().max(200_000).optional(),
  parseStatus: z.enum(['pending', 'ready', 'failed', 'not_applicable']),
  replacesDocumentId: z.string().uuid().optional(),
});

export const documentRetentionSchema = z.object({
  retentionUntil: z.string().datetime({ offset: true }).nullable(),
});

export const adminUserQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminUserPatchSchema = z.object({
  role: z.enum(['candidate', 'admin']).optional(),
  email: z.string().email().nullable().optional(),
  displayName: z.string().max(255).nullable().optional(),
  headline: z.string().max(255).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  workMode: z.enum(['office', 'hybrid', 'remote', 'flexible']).nullable().optional(),
  subscriptionTier: z.enum(['free', 'pro', 'executive', 'enterprise']).optional(),
  subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled']).optional(),
  subscriptionExpiresAt: z.string().nullable().optional(),
  subscriptionNotes: z.string().max(1000).nullable().optional(),
});

export const adminUserBlockSchema = z.object({
  blocked: z.boolean(),
});

export const adminUserPasswordResetSchema = z.object({
  newPassword: z.string().min(8).max(256),
});

export const adminVacancyQuerySchema = z.object({
  sourceId: z.string().optional(),
  type: z.string().optional(),
  query: z.string().optional(),
  isRemote: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminVacancySourceTestSchema = z.object({
  query: z.string().max(100).optional(),
});

export const adminVacancySourceToggleSchema = z.object({
  enabled: z.boolean(),
});

export const hhMarketQuerySchema = z.object({
  text: z.string().trim().min(2).max(200),
  perPage: z.coerce.number().int().min(1).max(20).default(12),
});

export const profileImportSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2_048)
    .transform((value) => (!/^https?:\/\//i.test(value) ? `https://${value}` : value))
    .refine((value) => {
      try {
        parseProfileUrl(value);
        return true;
      } catch {
        return false;
      }
    }),
});

export const oauthCallbackQuerySchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    code: z.string().min(8).max(2_048).optional(),
    error: z.string().max(200).optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.error));

export const coachTurnRequestSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(8_000),
  marketQuery: z.string().trim().min(2).max(200).optional(),
});

export const careerCommandRequestSchema = z.object({
  turnIdempotencyKey: z.string().uuid(),
  proposalIndex: z.number().int().min(0).max(19),
  executionTarget: hhApplicationExecutionTargetSchema.optional(),
});

export const careerCommandParamsSchema = z.object({
  commandId: z.string().uuid(),
});

export const memoryChangeSchema = z
  .object({
    action: z.enum(['confirm', 'correct', 'delete']),
    statement: z.string().trim().min(1).max(1_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === 'correct' && !value.statement) {
      context.addIssue({
        code: 'custom',
        path: ['statement'],
        message: 'statement is required for correction',
      });
    }
  });

export const assessmentIdSchema = z.enum(['work-preferences-v1', 'product-case-v1']);

export const resumeImportSchema = z
  .object({
    text: z.string().min(10).max(500_000),
    source: z.enum(['pdf', 'linkedin', 'hh', 'text']),
    fileName: z.string().trim().max(200).optional(),
  })
  .strict();
