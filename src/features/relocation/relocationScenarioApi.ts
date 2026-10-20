import { apiFetch, readDataObject, throwApiError } from '../coach/apiClient';
import type { RelocationScenarioInput, SavedRelocationScenario } from '../../../shared/relocationScenario';
const base = '/api/v1/candidate/relocation-scenarios';
export async function saveRelocationScenario(input: RelocationScenarioInput, key: string) {
  return readDataObject<SavedRelocationScenario>(await apiFetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input),
  }));
}
export async function listRelocationScenarios(offset = 0) {
  return readDataObject<{ items: SavedRelocationScenario[]; nextOffset: number | null }>(await apiFetch(`${base}?limit=20&offset=${offset}`));
}
export async function deleteRelocationScenario(id: string) {
  const response = await apiFetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) await throwApiError(response);
}
