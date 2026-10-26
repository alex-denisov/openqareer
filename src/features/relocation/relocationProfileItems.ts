import type {
  RelocationQuestionnaire,
  RelocationStepId,
} from '../../../shared/relocationQuestionnaire';
import { getResumeStudio, saveResumeStudioDraft } from '../resume/resumeApi';
import { putRelocationQuestionnaireStep, type RelocationStepInput } from './relocationApi';
import { applyRelocationStepToDraft, isProfileFactRow } from './relocationProfileFacts';

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

export type ProfileSync = 'saved' | 'unchanged' | 'failed';

/**
 * Saves one questionnaire step, then copies what it added into the candidate's
 * profile (citizenship, diplomas, languages), so the facts live in one place.
 * A failed profile write does not undo the relocation save; the caller says so.
 */
export async function saveRelocationStep(step: RelocationStepId, profile: RelocationQuestionnaire) {
  const result = await saveRelocationStepOnly(step, profile);
  return { ...result, profileSync: await syncStepToProfile(step, result.profile) };
}

async function syncStepToProfile(
  step: RelocationStepId,
  profile: RelocationQuestionnaire,
): Promise<ProfileSync> {
  try {
    const { draft } = await getResumeStudio();
    const next = draft ? applyRelocationStepToDraft(draft, step, profile) : null;
    if (!next) return 'unchanged';
    await saveResumeStudioDraft(next);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** One questionnaire step with optimistic revision; the server answers with the new profile. */
function saveRelocationStepOnly(step: RelocationStepId, profile: RelocationQuestionnaire) {
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

export function relocationLanguageSourceLabel(source: string, rowId = ''): string {
  if (isProfileFactRow(rowId)) return 'из профиля';
  if (source === 'candidate') return 'со слов кандидата';
  if (source === 'linkedin') return 'из LinkedIn';
  if (source === 'certificate') return 'по сертификату';
  return 'источник не указан';
}
