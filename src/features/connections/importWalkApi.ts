import { apiFetch } from '../coach/apiClient';
import type { ImportWalk } from '../coach/coachApi';

/** B541: keeps the last section walk on the server so the profile shows it after a reload. */
export async function saveImportWalk(
  platform: ImportWalk['platform'],
  walk: Pick<ImportWalk, 'state' | 'sections'>,
): Promise<void> {
  const response = await apiFetch(`/api/v1/candidate/connections/${platform}/walk`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(walk),
  });
  if (!response.ok) throw new Error(`import walk ${response.status}`);
}
