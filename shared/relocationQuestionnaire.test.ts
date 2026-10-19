import { describe, expect, it } from 'vitest';
import {
  RELOCATION_CONSENT_STATUS,
  RELOCATION_STEPS,
  emptyRelocationQuestionnaire,
  getNextRelocationStep,
  relocationAlerts,
  relocationQuestionnaireStepSchemas,
  relocationProgressSchema,
} from './relocationQuestionnaire';

describe('relocation questionnaire contract', () => {
  it('has four resumable steps and starts at citizenship without a consented record', () => {
    const empty = emptyRelocationQuestionnaire();

    expect(RELOCATION_STEPS).toEqual(['citizenship_documents', 'education', 'family', 'languages']);
    expect(empty.currentStep).toBe('citizenship_documents');
    expect(empty.revision).toBe(0);
    expect(empty.citizenshipDocuments.citizenshipCountryCodes).toEqual([]);
  });

  it('moves to the next step and then to the summary', () => {
    expect(getNextRelocationStep('citizenship_documents')).toBe('education');
    expect(getNextRelocationStep('family')).toBe('languages');
    expect(getNextRelocationStep('languages')).toBe('summary');
  });

  it('keeps the current step distinct from the skipped-step list', () => {
    expect(
      relocationProgressSchema.safeParse({
        currentStep: 'family',
        skippedSteps: ['education'],
      }).success,
    ).toBe(true);
    expect(
      relocationProgressSchema.safeParse({
        currentStep: 'family',
        skippedSteps: ['family'],
      }).success,
    ).toBe(false);
  });

  it('validates the document step and rejects passport numbers and malformed dates', () => {
    const schema = relocationQuestionnaireStepSchemas.citizenship_documents;
    const valid = schema.parse({
      citizenshipCountryCodes: ['RU'],
      documents: [
        {
          id: 'permit-1',
          kind: 'residence_permit',
          countryCode: 'DE',
          issuedAt: '2025-01-01',
          expiresAt: '2027-01-01',
        },
      ],
    });
    expect(valid.documents).toHaveLength(1);
    expect(
      schema.safeParse({
        citizenshipCountryCodes: ['RU'],
        documents: [],
        passportNumber: '1234567',
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        citizenshipCountryCodes: ['RU'],
        documents: [{ id: 'permit-1', kind: 'visa', countryCode: 'DE', expiresAt: '2026-02-31' }],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ citizenshipCountryCodes: ['RU', 'RU'], documents: [] }).success).toBe(
      false,
    );
  });

  it('validates education, certificates, family and language rows with bounded private fields', () => {
    expect(
      relocationQuestionnaireStepSchemas.education.safeParse({
        education: [
          {
            id: 'education-1',
            level: 'bachelor',
            title: 'Прикладная математика',
            countryCode: 'RU',
            recognitionStatus: 'in_progress',
          },
        ],
        certificates: [
          {
            id: 'certificate-1',
            title: 'IELTS',
            countryCode: 'GB',
            expiresAt: '2027-04-01',
            recognitionStatus: 'unknown',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      relocationQuestionnaireStepSchemas.family.safeParse({
        partnerStatus: 'has_partner',
        childrenCount: 2,
        relocationTimeframe: 'six_to_twelve_months',
        familyMovePlan: 'later',
        childNames: ['Алексей'],
      }).success,
    ).toBe(false);
    expect(
      relocationQuestionnaireStepSchemas.languages.safeParse({
        languages: [
          {
            id: 'language-1',
            name: 'English',
            level: 'C1',
            source: 'linkedin',
            confirmation: 'proposed',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('reports missing citizenship and documents expiring within 30 days', () => {
    const profile = {
      ...emptyRelocationQuestionnaire(),
      citizenshipDocuments: {
        citizenshipCountryCodes: [],
        documents: [
          { id: 'soon', kind: 'work_visa' as const, countryCode: 'DE', expiresAt: '2026-10-25' },
          {
            id: 'later',
            kind: 'residence_permit' as const,
            countryCode: 'DE',
            expiresAt: '2026-12-31',
          },
        ],
      },
    };

    expect(relocationAlerts(profile, '2026-10-10')).toEqual([
      { kind: 'citizenship_missing' },
      { kind: 'document_expiring', documentId: 'soon', expiresAt: '2026-10-25' },
    ]);
  });

  it('keeps consent unavailable until the separate consent text receives approval', () => {
    expect(RELOCATION_CONSENT_STATUS).toBe('approved');
  });
});
