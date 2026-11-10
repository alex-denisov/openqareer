import type { ApplicationView } from '../applications/applicationsApi';
import type { useApplications } from '../applications/useApplications';

/** Vacancies whose response card sits in the archive: their row says «Отклик в архиве». */
export function archivedClusterIds(applications: readonly ApplicationView[]): ReadonlySet<string> {
  return new Set(
    applications
      .filter((application) => application.stage === 'archived' && application.clusterId)
      .map((application) => application.clusterId as string),
  );
}

/** B631: «Вернуть из архива» on a vacancy restores the archived response card of that vacancy. */
export async function restoreArchivedVacancy(
  tracker: ReturnType<typeof useApplications>,
  clusterId: string,
): Promise<void> {
  const archived = tracker.applications.find(
    (application) => application.clusterId === clusterId && application.stage === 'archived',
  );
  if (!archived) throw new Error('Архивный отклик этой вакансии не найден.');
  await tracker.restoreFromArchive(archived);
}
