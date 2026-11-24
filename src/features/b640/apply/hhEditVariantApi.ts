import type { TextVariantList } from '../../../../shared/textVariants';
import { apiFetch, readDataObject } from '../../coach/apiClient';

/** B682 (a01c): варианты правки резюме hh.ru; у навыков вместе с текстом — что добавится на hh.ru. */
export type HhEditVariantList = TextVariantList<{ readonly added?: readonly string[] }>;

export async function listHhEditVariants(subjectId: string, signal: AbortSignal): Promise<HhEditVariantList> {
  const query = new URLSearchParams({ kind: 'resume', subjectId }).toString();
  return readDataObject<HhEditVariantList>(await apiFetch(`/api/v1/candidate/text-variants?${query}`, { signal }));
}

export async function createHhEditVariant(vacancyId: string, subjectId: string): Promise<HhEditVariantList> {
  const response = await apiFetch('/api/v1/candidate/hh/resumes/edits/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vacancyId, subjectId }),
  });
  return readDataObject<HhEditVariantList>(response);
}
