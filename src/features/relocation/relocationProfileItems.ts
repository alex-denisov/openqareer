import type {
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { putRelocationQuestionnaireStep, type RelocationStepInput } from './relocationApi';

const CITIZENSHIP_ROW = 'citizenship:';

/** Row id of a citizenship in «Мои данные»: citizenship has no id of its own. */
export function citizenshipRowId(countryCode: string): string {
  return `${CITIZENSHIP_ROW}${countryCode}`;
}

/** «Удалить» on one row of «Мои данные»: a new profile without that item. */
export function removeRelocationItem(
  profile: RelocationQuestionnaire,
  step: RelocationStepId,
  itemId: string,
): RelocationQuestionnaire {
  if (step === 'citizenship_documents') {
    const { citizenshipCountryCodes, documents } = profile.citizenshipDocuments;
    return {
      ...profile,
      citizenshipDocuments: {
        citizenshipCountryCodes: citizenshipCountryCodes.filter(
          (code) => citizenshipRowId(code) !== itemId,
        ),
        documents: documents.filter(({ id }) => id !== itemId),
      },
    };
  }
  if (step === 'education') {
    return {
      ...profile,
      education: {
        education: profile.education.education.filter(({ id }) => id !== itemId),
        certificates: profile.education.certificates.filter(({ id }) => id !== itemId),
      },
    };
  }
  if (step === 'languages') {
    return {
      ...profile,
      languages: { languages: profile.languages.languages.filter(({ id }) => id !== itemId) },
    };
  }
  return profile;
}

/** Saves one questionnaire step with optimistic revision; the server answers with the new profile. */
export function saveRelocationStep(step: RelocationStepId, profile: RelocationQuestionnaire) {
  switch (step) {
    case 'citizenship_documents':
      return putRelocationQuestionnaireStep(step, profile.citizenshipDocuments, profile.revision);
    case 'education':
      return putRelocationQuestionnaireStep(step, profile.education, profile.revision);
    case 'family':
      return putRelocationQuestionnaireStep(step, profile.family, profile.revision);
    case 'languages':
      return putRelocationQuestionnaireStep(
        step,
        relocationLanguageInput(profile),
        profile.revision,
      );
  }
}

export function relocationLanguageInput(
  profile: RelocationQuestionnaire,
): RelocationStepInput['languages'] {
  return {
    languages: profile.languages.languages.map(({ id, name, level, confirmation }) => ({
      id,
      name,
      level,
      confirmation,
    })),
  };
}

export function relocationLanguageSourceLabel(source: string): string {
  if (source === 'candidate') return 'со слов кандидата';
  if (source === 'linkedin') return 'из LinkedIn';
  if (source === 'certificate') return 'по сертификату';
  return 'источник не указан';
}
