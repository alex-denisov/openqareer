export interface VacancyPitchPayload {
  readonly tone?: 'executive' | 'confident' | 'technical';
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
  readonly generatedAt: string;
}

export async function requestVacancyPitch(
  vacancyId: string,
  payload?: VacancyPitchPayload,
): Promise<VacancyPitchResult> {
  const response = await fetch(`/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/pitch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(
      errorBody?.error?.message ?? 'Не удалось сгенерировать материалы отклика.',
    );
  }

  const json = (await response.json()) as { data: VacancyPitchResult };
  return json.data;
}
