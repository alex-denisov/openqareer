import { apiFetch, readData } from '../coach/apiClient';

export interface VacancyPitchPayload {
  readonly tone?: 'executive' | 'confident' | 'technical';
  /** Overrides the letter's auto-detected language. */
  readonly language?: 'en' | 'ru';
  readonly vacancy?: {
    readonly title?: string;
    readonly company?: string;
    readonly description?: string;
    readonly requiredSkills?: readonly string[];
    readonly responsibilities?: readonly string[];
    readonly location?: string;
    readonly isRemote?: boolean;
  };
}

export interface VacancyPitchResult {
  readonly vacancyId: string;
  readonly emailPitch: {
    readonly subject: string;
    readonly body: string;
  };
  readonly linkedInNote: string;
  readonly atsCoverLetter: string;
  readonly usedEvidenceIds: readonly string[];
  readonly usedFacts?: readonly { id: string; basis: 'confirmed' | 'imported' }[];
  readonly language?: 'en' | 'ru';
  /** UI hints such as "few facts" or "requirements unmatched" — never letter text. */
  readonly notices?: readonly string[];
  readonly generatedAt: string;
}

/**
 * Через `apiFetch`, как все запросы кабинета: голый `fetch('/api/…')` в
 * десктопном WebKit падал на относительном адресе («The string did not match
 * the expected pattern») и не нёс ни токена, ни Origin (PRB-041).
 */
export async function requestVacancyPitch(
  vacancyId: string,
  payload?: VacancyPitchPayload,
): Promise<VacancyPitchResult> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/pitch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    },
  );
  return readData<VacancyPitchResult>(response);
}
