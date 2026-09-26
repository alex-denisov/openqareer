import { z } from 'zod';
import { getEmailError, getNameError, getPasswordError } from '../../shared/accountValidation';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { linkedinProfileV2Schema } from '../../shared/linkedinProfileV2';
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

/**
 * B173 — the candidate accepts the published pack before the product receives
 * their resume. The accepted version travels with the registration so the
 * stored proof names the exact text that was on screen, and a stale tab cannot
 * record acceptance of a document it never showed.
 */
export const registrationSchema = z.object({
  displayName: fieldGovernedBy(getNameError, true),
  email: fieldGovernedBy(getEmailError, true),
  password: passwordField,
  legalConsent: z
    .object(
      { versionId: z.string().trim().min(1).max(120) },
      {
        error:
          'Примите пользовательское соглашение, политику обработки персональных данных и согласие — без этого регистрация невозможна.',
      },
    )
    .refine((value) => value.versionId === LEGAL_PACK_VERSION_ID, {
      message:
        'Документы обновились, пока была открыта страница. Обновите страницу и примите действующую редакцию.',
    }),
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

/**
 * Часть файла. Тело запроса держится внутри бюджета маршрута: целиком файл в
 * 86 КБ до сервера не доезжает — ответа на него нет вовсе (INC-031).
 */
export const documentPartSchema = z.object({
  uploadId: z.string().uuid(),
  index: z.number().int().min(0).max(4_096),
  total: z.number().int().min(1).max(4_096),
  part: z
    .string()
    .min(1)
    .max(16_384)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});

export const candidateDocumentSchema = z
  .object({
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
    // Либо файл целиком, либо идентификатор загрузки, собранной из частей.
    contentBase64: z
      .string()
      .min(4)
      .max(7_100_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
      .optional(),
    uploadId: z.string().uuid().optional(),
    extractedText: z.string().trim().max(200_000).optional(),
    parseStatus: z.enum(['pending', 'ready', 'failed', 'not_applicable']),
    replacesDocumentId: z.string().uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.contentBase64) !== Boolean(value.uploadId),
    'Нужен либо файл целиком, либо идентификатор собранной загрузки.',
  );

/** Смещение страницы разобранного текста: маршрут отдаёт его частями (INC-034). */
export const documentTextQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

export const documentRetentionSchema = z.object({
  retentionUntil: z.string().datetime({ offset: true }).nullable(),
});

export const adminUserQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  searchField: z.enum(['all', 'username', 'email', 'displayName']).default('all'),
  role: z.enum(['candidate', 'admin']).optional(),
  tier: z.enum(['free', 'pro', 'executive', 'enterprise']).optional(),
  blocked: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sortBy: z.enum(['name', 'role', 'tier', 'created', 'sessions']).default('created'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminAuditQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  action: z.string().trim().max(80).optional(),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

const linkedinAccountIdSchema = z.string().uuid();
// The admin sees and owns the provider login identifier. It is commonly an
// email, but some governed provider accounts use a label or username instead.
// Keep the field bounded without forcing an email-shaped value in the UI.
const linkedinEmailLoginSchema = z.string().trim().min(1).max(254);
const linkedinAdminLabelSchema = z.string().trim().min(1).max(120);

export const adminLinkedinPoolQuerySchema = z.object({
  state: z
    .enum([
      'unconfigured',
      'login_required',
      'user_action_required',
      'checking',
      'ready',
      'expired',
      'challenge_required',
      'cooling_down',
      'revoked',
      'banned',
      'disabled',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const adminLinkedinPoolCreateSchema = z.object({
  adminLabel: linkedinAdminLabelSchema,
  emailLogin: linkedinEmailLoginSchema,
  providerAccountMarker: z.string().trim().min(1).max(240).optional(),
});

export const adminLinkedinPoolPatchSchema = z.object({
  revision: z.number().int().min(0),
  adminLabel: linkedinAdminLabelSchema.optional(),
  emailLogin: linkedinEmailLoginSchema.optional(),
  providerAccountMarker: z.string().trim().max(240).nullable().optional(),
});

export const adminLinkedinPoolParamsSchema = z.object({
  accountId: linkedinAccountIdSchema,
});

export const adminLinkedinPoolDeleteSchema = z.object({
  revision: z.number().int().min(0),
});

export const adminLinkedinPoolCompleteSchema = z.object({
  handle: z.string().regex(/^lhs_[A-Za-z0-9_-]{40,}$/),
  state: z.enum(['ready', 'login_required', 'challenge_required', 'expired', 'banned']),
  accountMarker: z.string().trim().max(240).optional(),
});

export const adminVacancyQuerySchema = z.object({
  sourceId: z.string().optional(),
  type: z.string().optional(),
  // Поиск — линейный проход по поисковой строке всего пула в базе (B221);
  // длина иглы ограничена, чтобы один запрос админа не занял процесс.
  query: z.string().trim().max(80).optional(),
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

/**
 * Dossier facts are not all UUIDs: an import mints readable ids such as
 * `imp7f3a91-exp-2`, so a UUID-only parameter rejected every attempt to
 * confirm an imported fact (B166).
 */
export const memoryIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** One candidate decision over a whole imported batch, not one request per fact. */
export const memoryReviewSchema = z.object({
  action: z.enum(['confirm', 'delete']),
  memoryIds: z.array(memoryIdSchema).min(1).max(200),
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

export const assessmentIdSchema = z.enum(['product-case-v1']);

export const resumeImportSchema = z
  .object({
    text: z.string().min(10).max(500_000),
    source: z.enum(['pdf', 'linkedin', 'hh', 'text']),
    fileName: z.string().trim().max(200).optional(),
    /** Why the device's LinkedIn structured capture fell back to text (B266). */
    structuredFallback: z.enum(['extract_failed', 'no_substance', 'schema_rejected']).optional(),
    sourceReceipt: z
      .object({
        platform: z.enum(['hh', 'linkedin']),
        accessMode: z.literal('native_session_snapshot'),
        sourceUrl: z
          .string()
          .url()
          .max(2_048)
          .refine((value) => {
            const url = new URL(value);
            if (url.protocol !== 'https:') return false;
            if (url.hostname === 'hh.ru') {
              return /^\/resume\/[A-Za-z0-9_-]{3,200}$/u.test(url.pathname);
            }
            return (
              (url.hostname === 'linkedin.com' ||
                url.hostname.endsWith('.linkedin.com') ||
                url.hostname === 'linkedin.cn' ||
                url.hostname.endsWith('.linkedin.cn')) &&
              /^\/in\/[^/]{2,200}\/?$/u.test(url.pathname)
            );
          }),
        capturedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceReceipt && value.source !== value.sourceReceipt.platform) {
      context.addIssue({
        code: 'custom',
        path: ['sourceReceipt'],
        message: 'sourceReceipt platform must match the native import source',
      });
    }
    if (value.sourceReceipt) {
      const url = new URL(value.sourceReceipt.sourceUrl);
      const matchesPlatform =
        value.sourceReceipt.platform === 'hh'
          ? url.hostname === 'hh.ru' && url.pathname.startsWith('/resume/')
          : (url.hostname === 'linkedin.com' ||
              url.hostname.endsWith('.linkedin.com') ||
              url.hostname === 'linkedin.cn' ||
              url.hostname.endsWith('.linkedin.cn')) &&
            url.pathname.startsWith('/in/');
      if (!matchesPlatform) {
        context.addIssue({
          code: 'custom',
          path: ['sourceReceipt', 'sourceUrl'],
          message: 'sourceReceipt URL must match its platform',
        });
      }
    }
    if (
      value.sourceReceipt &&
      Date.parse(value.sourceReceipt.capturedAt) > Date.now() + 5 * 60 * 1_000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceReceipt', 'capturedAt'],
        message: 'capturedAt cannot be in the future',
      });
    }
  });

/**
 * `POST /candidate/resume/import/structured` (B265 §2, slice 3). Unlike
 * `resumeImportSchema`, there is no free-text `text` field at all — the DOM
 * was already parsed on the candidate's device, and the server never runs a
 * model or a text reader over this payload (architecture §2, §7: p95 <1s
 * without media, no LLM call on this route ever).
 */
export const structuredResumeImportSchema = z
  .object({
    schemaVersion: z.literal(2),
    source: z.literal('linkedin'),
    extractorVersion: z.string().trim().min(1).max(60),
    /** Field paths (never values) the device removed to pass the schema (B266). */
    droppedFields: z.array(z.string().regex(/^[A-Za-z0-9_.:[\]]{1,120}$/u)).max(40).optional(),
    sourceReceipt: z
      .object({
        platform: z.literal('linkedin'),
        accessMode: z.literal('native_session_snapshot'),
        sourceUrl: z
          .string()
          .url()
          .max(2_048)
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === 'https:' &&
              (url.hostname === 'linkedin.com' ||
                url.hostname.endsWith('.linkedin.com') ||
                url.hostname === 'linkedin.cn' ||
                url.hostname.endsWith('.linkedin.cn')) &&
              /^\/in\/[^/]{2,200}\/?$/u.test(url.pathname)
            );
          }, 'sourceReceipt.sourceUrl must be an https linkedin.com/in/... profile URL'),
        capturedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .superRefine((value, context) => {
        if (Date.parse(value.capturedAt) > Date.now() + 5 * 60 * 1_000) {
          context.addIssue({
            code: 'custom',
            path: ['capturedAt'],
            message: 'capturedAt cannot be in the future',
          });
        }
      }),
    // The shared profile schema repairs older flat language/level rows before import planning.
    profile: linkedinProfileV2Schema,
  })
  .strict();
