import { prepareCareerWorkspace } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace, WorkspaceInput, WorkspaceLoadResult } from './workspaceStorage';

export interface WorkspaceSources {
  readonly local: WorkspaceLoadResult;
  readonly remote: WorkspaceInput | null;
}

/**
 * Decides which career context the signed-in candidate actually has.
 *
 * Browser storage is a cache: `clearWorkspace` empties it on sign-out, and a
 * different browser never had it. The server holds the answers the candidate
 * gave the wizard, so an empty or unreadable cache is a reason to read the
 * record — not a reason to treat a returning candidate as brand new and lock
 * every section behind the diagnostic again (INC-024).
 *
 * A readable local copy wins, because it may hold edits made since the last
 * write-through.
 */
export function resolveCandidateWorkspace({
  local,
  remote,
}: WorkspaceSources): CandidateWorkspace | undefined {
  if (local.status === 'ready') return local.workspace;
  if (!remote) return undefined;
  return prepareCareerWorkspace(remote);
}
