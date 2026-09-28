import { apiFetch, readDataObject } from '../coach/apiClient';
import type { CandidateMemory } from '../coach/coachApi';

export async function addManualExperienceFact(input: {
  readonly statement: string;
  readonly experienceId?: string;
  readonly idempotencyKey: string;
}): Promise<CandidateMemory> {
  const response = await apiFetch('/api/v1/candidate/experience-facts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      statement: input.statement,
      ...(input.experienceId ? { experienceId: input.experienceId } : {}),
    }),
  });
  return readDataObject<{ memory: CandidateMemory }>(response).then((result) => result.memory);
}
