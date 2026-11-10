import { apiFetch, readDataObject } from '../coach/apiClient';

/** B639: настоящее название вместо маски работодателя или ответ «это и есть название». */
export type EmployerNameAnswer = { readonly name: string } | { readonly keepAsIs: true };

export async function answerEmployerName(
  employer: string,
  answer: EmployerNameAnswer,
  idempotencyKey: string,
): Promise<void> {
  const response = await apiFetch('/api/v1/candidate/experience/employer-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ employer, ...answer }),
  });
  await readDataObject<{ memory: unknown }>(response);
}
