import { z } from 'zod';

export const RELOCATION_CONSENT_VERSION = 'relocation-questionnaire-v1.0';
/** Текст согласия утверждён владельцем 19.10.2026. */
export const RELOCATION_CONSENT_STATUS = 'approved' as const;
export const RELOCATION_CONSENT_TEXT_APPROVED = true;

export const RELOCATION_STEPS = [
  'citizenship_documents',
  'education',
  'family',
  'languages',
] as const;

export type RelocationStepId = (typeof RELOCATION_STEPS)[number];
export type RelocationCurrentStep = RelocationStepId | 'summary';

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/u);
const dateSchema = z.iso.date();
const rowIdSchema = z.string().trim().min(1).max(80);
const shortLabelSchema = z.string().trim().min(1).max(160);
const stepIdSchema = z.enum(RELOCATION_STEPS);
const currentStepSchema = z.enum([...RELOCATION_STEPS, 'summary']);

export const relocationDocumentSchema = z
  .object({
    id: rowIdSchema,
    kind: z.enum(['residence_permit', 'work_permit', 'work_visa', 'study_visa', 'visa', 'other']),
    countryCode: countryCodeSchema,
    issuedAt: dateSchema.optional(),
    expiresAt: dateSchema.optional(),
  })
  .strict()
  .refine(
    (document) =>
      !document.issuedAt || !document.expiresAt || document.issuedAt <= document.expiresAt,
    {
      path: ['expiresAt'],
      message: 'Дата окончания не может быть раньше даты выдачи.',
    },
  );

export const relocationEducationSchema = z
  .object({
    id: rowIdSchema,
    level: z.enum(['secondary', 'vocational', 'bachelor', 'master', 'doctorate', 'other']),
    title: shortLabelSchema,
    fieldOfStudy: z.string().trim().max(160).optional(),
    countryCode: countryCodeSchema,
    startedAt: dateSchema.optional(),
    completedAt: dateSchema.optional(),
    recognitionStatus: z.enum([
      'recognized',
      'in_progress',
      'not_started',
      'not_required',
      'unknown',
    ]),
  })
  .strict()
  .refine(
    (education) =>
      !education.startedAt ||
      !education.completedAt ||
      education.startedAt <= education.completedAt,
    {
      path: ['completedAt'],
      message: 'Дата окончания не может быть раньше даты начала.',
    },
  );

export const relocationCertificateSchema = z
  .object({
    id: rowIdSchema,
    title: shortLabelSchema,
    issuer: z.string().trim().max(160).optional(),
    countryCode: countryCodeSchema,
    issuedAt: dateSchema.optional(),
    expiresAt: dateSchema.optional(),
    recognitionStatus: z.enum([
      'recognized',
      'in_progress',
      'not_started',
      'not_required',
      'unknown',
    ]),
  })
  .strict()
  .refine(
    (certificate) =>
      !certificate.issuedAt ||
      !certificate.expiresAt ||
      certificate.issuedAt <= certificate.expiresAt,
    {
      path: ['expiresAt'],
      message: 'Дата окончания не может быть раньше даты выдачи.',
    },
  );

const uniqueRows = <T extends { readonly id: string }>(rows: readonly T[]) =>
  new Set(rows.map(({ id }) => id)).size === rows.length;

export const relocationQuestionnaireStepSchemas = {
  citizenship_documents: z
    .object({
      citizenshipCountryCodes: z
        .array(countryCodeSchema)
        .max(10)
        .refine((codes) => new Set(codes).size === codes.length),
      documents: z.array(relocationDocumentSchema).max(20).refine(uniqueRows),
    })
    .strict(),
  education: z
    .object({
      education: z.array(relocationEducationSchema).max(20).refine(uniqueRows),
      certificates: z.array(relocationCertificateSchema).max(30).refine(uniqueRows),
    })
    .strict(),
  family: z
    .object({
      partnerStatus: z.enum(['has_partner', 'no_partner', 'undecided', 'unknown']),
      childrenCount: z.number().int().min(0).max(10).optional(),
      relocationTimeframe: z.enum([
        'under_three_months',
        'three_to_six_months',
        'six_to_twelve_months',
        'over_twelve_months',
        'unknown',
      ]),
      familyMovePlan: z.enum(['together', 'later', 'not_applicable', 'undecided']),
    })
    .strict(),
  languages: z
    .object({
      languages: z
        .array(
          z
            .object({
              id: rowIdSchema,
              name: shortLabelSchema,
              level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'unknown']),
              source: z.enum(['candidate', 'linkedin', 'certificate']),
              sourceCapturedAt: z.iso.datetime().optional(),
              sourceLabel: z.string().trim().max(160).optional(),
              confirmation: z.enum(['proposed', 'confirmed']),
            })
            .strict(),
        )
        .max(30)
        .refine(uniqueRows),
    })
    .strict(),
} as const;

export const relocationLanguageStepInputSchema = z
  .object({
    languages: z
      .array(
        z
          .object({
            id: rowIdSchema,
            name: shortLabelSchema,
            level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'unknown']),
            confirmation: z.enum(['proposed', 'confirmed']),
          })
          .strict(),
      )
      .max(30)
      .refine(uniqueRows),
  })
  .strict();

export type CitizenshipDocumentsStep = z.infer<
  typeof relocationQuestionnaireStepSchemas.citizenship_documents
>;
export type EducationStep = z.infer<typeof relocationQuestionnaireStepSchemas.education>;
export type FamilyStep = z.infer<typeof relocationQuestionnaireStepSchemas.family>;
export type LanguagesStep = z.infer<typeof relocationQuestionnaireStepSchemas.languages>;
export type RelocationLanguageStepInput = z.infer<typeof relocationLanguageStepInputSchema>;
export type RelocationQuestionnaireStepData = {
  readonly citizenship_documents: CitizenshipDocumentsStep;
  readonly education: EducationStep;
  readonly family: FamilyStep;
  readonly languages: LanguagesStep;
};

/** Countries the candidate picked for comparison (mockup 15 «Выбор сохраняется»), up to three. */
export const RELOCATION_COMPARISON_LIMIT = 3;
const selectedCountryCodesSchema = z
  .array(z.string().regex(/^[A-Z]{2}$/u))
  .max(RELOCATION_COMPARISON_LIMIT)
  .refine((codes) => new Set(codes).size === codes.length);

export const relocationProgressSchema = z
  .object({
    currentStep: currentStepSchema,
    skippedSteps: z
      .array(stepIdSchema)
      .max(RELOCATION_STEPS.length)
      .refine((steps) => new Set(steps).size === steps.length),
    selectedCountryCodes: selectedCountryCodesSchema.optional(),
  })
  .strict()
  .refine(
    (progress) =>
      progress.currentStep === 'summary' || !progress.skippedSteps.includes(progress.currentStep),
    {
      path: ['currentStep'],
      message: 'Текущий шаг нельзя одновременно отметить пропущенным.',
    },
  );

export const relocationQuestionnaireSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    currentStep: currentStepSchema,
    skippedSteps: z
      .array(stepIdSchema)
      .max(RELOCATION_STEPS.length)
      .refine((steps) => new Set(steps).size === steps.length),
    citizenshipDocuments: relocationQuestionnaireStepSchemas.citizenship_documents,
    education: relocationQuestionnaireStepSchemas.education,
    family: relocationQuestionnaireStepSchemas.family,
    languages: relocationQuestionnaireStepSchemas.languages,
    selectedCountryCodes: selectedCountryCodesSchema.default([]),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .refine(
    (profile) =>
      profile.currentStep === 'summary' || !profile.skippedSteps.includes(profile.currentStep),
    {
      path: ['currentStep'],
      message: 'Текущий шаг нельзя одновременно отметить пропущенным.',
    },
  );

export type RelocationQuestionnaire = z.infer<typeof relocationQuestionnaireSchema>;

export interface RelocationConsentState {
  readonly status: 'not_granted' | 'granted' | 'revoked';
  readonly granted: boolean;
  readonly versionId: string | null;
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
}

export type RelocationAlert =
  | { readonly kind: 'citizenship_missing' }
  | { readonly kind: 'document_expiring'; readonly documentId: string; readonly expiresAt: string }
  | { readonly kind: 'document_expired'; readonly documentId: string; readonly expiresAt: string };

export function emptyRelocationQuestionnaire(): RelocationQuestionnaire {
  return {
    schemaVersion: 1,
    revision: 0,
    currentStep: RELOCATION_STEPS[0],
    skippedSteps: [],
    citizenshipDocuments: { citizenshipCountryCodes: [], documents: [] },
    education: { education: [], certificates: [] },
    family: {
      partnerStatus: 'unknown',
      relocationTimeframe: 'unknown',
      familyMovePlan: 'undecided',
    },
    languages: { languages: [] },
    selectedCountryCodes: [],
    updatedAt: null,
  };
}

export function getNextRelocationStep(step: RelocationStepId): RelocationCurrentStep {
  const nextIndex = RELOCATION_STEPS.indexOf(step) + 1;
  return RELOCATION_STEPS[nextIndex] ?? 'summary';
}

export function relocationAlerts(
  profile: RelocationQuestionnaire,
  today: string,
): RelocationAlert[] {
  const alerts: RelocationAlert[] = [];
  if (profile.citizenshipDocuments.citizenshipCountryCodes.length === 0) {
    alerts.push({ kind: 'citizenship_missing' });
  }
  for (const document of profile.citizenshipDocuments.documents) {
    if (!document.expiresAt) continue;
    const dayDifference = dateDifferenceInDays(today, document.expiresAt);
    if (dayDifference < 0)
      alerts.push({
        kind: 'document_expired',
        documentId: document.id,
        expiresAt: document.expiresAt,
      });
    else if (dayDifference <= 30)
      alerts.push({
        kind: 'document_expiring',
        documentId: document.id,
        expiresAt: document.expiresAt,
      });
  }
  return alerts;
}

function dateDifferenceInDays(today: string, expiresAt: string): number {
  const todayTime = Date.parse(`${today}T00:00:00.000Z`);
  const expiryTime = Date.parse(`${expiresAt}T00:00:00.000Z`);
  if (!Number.isFinite(todayTime) || !Number.isFinite(expiryTime)) return Number.POSITIVE_INFINITY;
  return Math.floor((expiryTime - todayTime) / 86_400_000);
}
