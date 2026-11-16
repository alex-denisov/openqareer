import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VacancyApplicationSnapshot } from '../../../../shared/vacancyApplication';
import {
  createApplication,
  listApplications,
  patchApplication,
  restoreApplicationFromArchive,
  type ApplicationView,
} from '../../applications/applicationsApi';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';

type Cluster = MatchedVacancyItem['cluster'];

export function isSaved(application: ApplicationView | undefined): boolean {
  return application?.stage === 'saved';
}

/** Кандидат уже откликнулся: карточка есть и она не «сохранено» и не архив. */
export function appliedOn(application: ApplicationView | undefined): boolean {
  return Boolean(application) && application?.stage !== 'saved' && application?.stage !== 'archived';
}

export function replaceApplication(
  list: readonly ApplicationView[],
  updated: ApplicationView,
): readonly ApplicationView[] {
  return list.some((item) => item.id === updated.id)
    ? list.map((item) => (item.id === updated.id ? updated : item))
    : [...list, updated];
}

/** «12.11» → полдень по Москве этого дня; дата из будущего считается прошлогодней. */
export function parseShortDate(text: string, now: Date = new Date()): string | null {
  const match = /^\s*(\d{1,2})\.(\d{1,2})\s*$/u.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const build = (year: number): Date | null => {
    const date = new Date(Date.UTC(year, month - 1, day, 9));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  };
  const thisYear = build(now.getUTCFullYear());
  if (!thisYear) return null;
  const date = thisYear.getTime() > now.getTime() ? build(now.getUTCFullYear() - 1) : thisYear;
  return date ? date.toISOString() : null;
}

export function vacancySnapshot(cluster: Cluster): VacancyApplicationSnapshot {
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    url: cluster.primaryUrl,
    source: cluster.sources[0]?.sourceId ?? '',
  };
}

export interface VacancyLinks {
  readonly applications: readonly ApplicationView[];
  readonly byCluster: ReadonlyMap<string, ApplicationView>;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly reload: () => void;
  /** Сохранить или убрать из сохранённых; при сбое бросает ошибку. */
  readonly toggleSaved: (cluster: Cluster) => Promise<ApplicationView>;
  /** Отметить «уже откликнулись» с датой отклика; при сбое бросает ошибку. */
  readonly markApplied: (cluster: Cluster, occurredAt: string) => Promise<ApplicationView>;
}

async function persistSaved(
  cluster: Cluster,
  existing: ApplicationView | undefined,
): Promise<ApplicationView> {
  if (existing?.stage === 'saved') {
    return patchApplication(existing.id, { expectedVersion: existing.version, stage: 'archived' });
  }
  if (existing?.stage === 'archived' && existing.archivePreviousStage === 'saved') {
    return restoreApplicationFromArchive(existing.id, existing.version);
  }
  if (existing) throw new Error('По этой вакансии уже есть отклик');
  return createApplication({
    clusterId: cluster.id,
    manualVacancy: vacancySnapshot(cluster),
    stage: 'saved',
  });
}

async function persistApplied(
  cluster: Cluster,
  existing: ApplicationView | undefined,
  occurredAt: string,
): Promise<ApplicationView> {
  if (existing && existing.stage !== 'archived') {
    return patchApplication(existing.id, {
      expectedVersion: existing.version,
      stage: 'applied',
      occurredAt,
    });
  }
  return createApplication({
    clusterId: cluster.id,
    manualVacancy: vacancySnapshot(cluster),
    stage: 'applied',
    occurredAt,
  });
}

/** Карточки откликов кандидата: по ним строка знает «сохранена» и «откликнулся». */
export function useVacancyLinks(): VacancyLinks {
  const [applications, setApplications] = useState<readonly ApplicationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listApplications(controller.signal)
      .then((list) => {
        setApplications(list);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const byCluster = useMemo(() => {
    const map = new Map<string, ApplicationView>();
    for (const application of applications) {
      if (application.clusterId) map.set(application.clusterId, application);
    }
    return map;
  }, [applications]);

  const reload = useCallback(() => {
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  const toggleSaved = useCallback(
    async (cluster: Cluster) => {
      const updated = await persistSaved(cluster, byCluster.get(cluster.id));
      setApplications((list) => replaceApplication(list, updated));
      return updated;
    },
    [byCluster],
  );

  const markApplied = useCallback(
    async (cluster: Cluster, occurredAt: string) => {
      const updated = await persistApplied(cluster, byCluster.get(cluster.id), occurredAt);
      setApplications((list) => replaceApplication(list, updated));
      return updated;
    },
    [byCluster],
  );

  return { applications, byCluster, loading, failed, reload, toggleSaved, markApplied };
}
