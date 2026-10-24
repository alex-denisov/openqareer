import { apiFetch, readDataObject, apiRequestSignal, API_MUTATION_TIMEOUT_MS } from '../coach/apiClient';
import type { WorkspaceInput } from './workspaceStorage';

/** Explicit wizard completion; ordinary workspace saves never record this goal. */
export async function completeCandidateWorkspace(workspace: WorkspaceInput): Promise<WorkspaceInput> {
  const response = await apiFetch('/api/v1/candidate/workspace/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace }), signal: apiRequestSignal(undefined, API_MUTATION_TIMEOUT_MS),
  });
  return readDataObject<WorkspaceInput>(response);
}

