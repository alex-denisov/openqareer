import type {
  LetterVariantPayload,
  TextVariant,
  TextVariantList,
  VariantWish,
} from '../../../../../shared/textVariants';
import { apiFetch, readDataObject } from '../../../coach/apiClient';
import type { VacancyPitchPayload } from '../../../vacancies/vacancyPitchApi';

export type LetterVariant = TextVariant<LetterVariantPayload>;
export type LetterVariantList = TextVariantList<LetterVariantPayload>;

/** Другие варианты письма к вакансии (B682). */
export async function listLetterVariants(
  vacancyId: string,
  signal?: AbortSignal,
): Promise<LetterVariantList> {
  const query = new URLSearchParams({ kind: 'letter', subjectId: vacancyId });
  return readDataObject<LetterVariantList>(
    await apiFetch(`/api/v1/candidate/text-variants?${query.toString()}`, { signal }),
  );
}

/** Новый вариант письма с пожеланием кандидата; квоту откликов не расходует. */
export async function createLetterVariant(
  vacancyId: string,
  wish: VariantWish,
  letter: VacancyPitchPayload,
): Promise<LetterVariantList & { readonly variant: LetterVariant }> {
  const response = await apiFetch(
    `/api/v1/candidate/vacancies/${encodeURIComponent(vacancyId)}/pitch/variants`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish, letter }),
    },
  );
  return readDataObject<LetterVariantList & { readonly variant: LetterVariant }>(response);
}
