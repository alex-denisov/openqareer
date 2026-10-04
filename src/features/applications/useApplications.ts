import { useCallback, useEffect, useState } from 'react';
import type { ApplicationStage } from '../../../shared/applicationStage';
import type { SkipReasonId } from '../../../shared/skipReasons';
import {
  createApplication,
  createApplicationInterview,
  createVacancySkip,
  listApplications,
  patchApplication,
  restoreApplicationFromArchive,
  recordFollowUpSent,
  type ApplicationView,
  type CreateApplicationInput,
} from './applicationsApi';
import { CoachApiError } from '../coach/apiClient';
import {
  apiErrorMessage,
  isVersionConflict,
  optimisticStagePatch,
  replaceApplication,
  withKey,
  withoutKey,
} from './applicationListOps';

export type ApplicationsLoadStatus = 'loading' | 'error' | 'ready';

export interface FailedStageChange {
  readonly stage: ApplicationStage;
  readonly occurredAt?: string;
}

export interface UseApplications {
  readonly status: ApplicationsLoadStatus;
  readonly applications: readonly ApplicationView[];
  readonly error?: string;
  /** The load failed because the browser has no connection (offline state). */
  readonly offline: boolean;
  /** Cards whose stage write failed and can be retried as-is. */
  readonly failedChanges: ReadonlyMap<string, FailedStageChange>;
  /** Cards a 409 flagged as edited on another device: only a reload resolves them. */
  readonly conflicts: ReadonlySet<string>;
  readonly reload: () => void;
  readonly refreshApplications: () => Promise<readonly ApplicationView[]>;
  readonly changeStage: (id: string, stage: ApplicationStage, occurredAt?: string) => void;
  /** Moves the card to `interview` and records the interview date (B251 F5):
   * a plain stage patch never fills `nearestInterview`, so «Сегодня» and the
   * card's own «Подготовиться» would have no date and no prep door. */
  readonly scheduleInterview: (id: string, scheduledAt: string) => Promise<void>;
  readonly retryStageChange: (id: string) => void;
  readonly restoreFromArchive: (application: ApplicationView) => Promise<void>;
  readonly markFollowUpSent: (id: string) => Promise<void>;
  readonly saveNote: (id: string, notes: string) => void;
  readonly addManualCard: (input: CreateApplicationInput) => Promise<ApplicationView>;
  readonly skip: (application: ApplicationView, reasonId: SkipReasonId) => Promise<void>;
}

const NO_MATERIAL_FALLBACK = 'Не удалось загрузить отклики.';

/** Trecker board data (B251 S3): one load, optimistic writes, honest failure states. */
// eslint-disable-next-line max-lines-per-function
export function useApplications(): UseApplications {
  const [status, setStatus] = useState<ApplicationsLoadStatus>('loading');
  const [applications, setApplications] = useState<readonly ApplicationView[]>([]);
  const [error, setError] = useState<string>();
  const [offline, setOffline] = useState(false);
  const [failedChanges, setFailedChanges] = useState<ReadonlyMap<string, FailedStageChange>>(
    new Map(),
  );
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setFailedChanges(new Map());
    setConflicts(new Set());
    void listApplications()
      .then((list) => {
        if (!active) return;
        setApplications(list);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(apiErrorMessage(reason, NO_MATERIAL_FALLBACK));
        setOffline(reason instanceof CoachApiError && reason.code === 'network_error');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const refreshApplications = useCallback(async () => {
    const list = await listApplications();
    setApplications(list);
    setError(undefined);
    setOffline(false);
    setStatus('ready');
    return list;
  }, []);

  const writeStagePatch = useCallback(
    (
      id: string,
      stage: ApplicationStage,
      occurredAt: string | undefined,
      snapshot: readonly ApplicationView[],
    ) => {
      const current = snapshot.find((application) => application.id === id);
      if (!current) return;
      patchApplication(id, { expectedVersion: current.version, stage, occurredAt })
        .then((saved) => {
          setApplications((list) => replaceApplication(list, saved));
          setFailedChanges((map) => withoutKey(map, id));
        })
        .catch((reason: unknown) => {
          setApplications(snapshot);
          if (isVersionConflict(reason)) {
            setConflicts((set) => new Set(set).add(id));
          } else {
            setFailedChanges((map) => withKey(map, id, { stage, occurredAt }));
          }
        });
    },
    [],
  );

  const changeStage = useCallback(
    (id: string, stage: ApplicationStage, occurredAt?: string) => {
      setApplications((snapshot) => {
        setFailedChanges((map) => withoutKey(map, id));
        setConflicts((set) => without(set, id));
        writeStagePatch(id, stage, occurredAt, snapshot);
        return optimisticStagePatch(snapshot, id, { stage });
      });
    },
    [writeStagePatch],
  );

  const scheduleInterview = useCallback(
    async (id: string, scheduledAt: string) => {
      const interview = await createApplicationInterview(id, { round: 1, scheduledAt });
      setApplications((list) => {
        const current = list.find((application) => application.id === id);
        if (!current) return list;
        return replaceApplication(list, {
          ...current,
          stage: 'interview',
          stageChangedAt:
            current.stage === 'interview' ? current.stageChangedAt : (interview.scheduledAt ?? scheduledAt),
          version: current.version + (current.stage === 'interview' ? 0 : 1),
          nearestInterview: {
            id: interview.id,
            scheduledAt: interview.scheduledAt,
            prepStatus: interview.prepStatus,
            round: interview.round,
          },
        });
      });
      setFailedChanges((map) => withoutKey(map, id));
      setConflicts((set) => without(set, id));
      void refreshApplications().catch(() => undefined);
    },
    [refreshApplications],
  );

  const retryStageChange = useCallback(
    (id: string) => {
      const failed = failedChanges.get(id);
      if (failed) changeStage(id, failed.stage, failed.occurredAt);
    },
    [changeStage, failedChanges],
  );

  const restoreFromArchive = useCallback(async (application: ApplicationView) => {
    const restored = await restoreApplicationFromArchive(application.id, application.version);
    setApplications((list) => replaceApplication(list, restored));
    setFailedChanges((map) => withoutKey(map, application.id));
    setConflicts((set) => without(set, application.id));
  }, []);

  const markFollowUpSent = useCallback(async (id: string) => {
    const saved = await recordFollowUpSent(id);
    setApplications((list) => replaceApplication(list, saved));
  }, []);

  const saveNote = useCallback((id: string, notes: string) => {
    setApplications((snapshot) => {
      const current = snapshot.find((application) => application.id === id);
      if (current) {
        void patchApplication(id, { expectedVersion: current.version, notes })
          .then((saved) => setApplications((list) => replaceApplication(list, saved)))
          .catch((reason: unknown) => {
            if (isVersionConflict(reason)) {
              setConflicts((set) => new Set(set).add(id));
            }
          });
      }
      return snapshot;
    });
  }, []);

  const addManualCard = useCallback(async (input: CreateApplicationInput) => {
    const created = await createApplication(input);
    setApplications((list) =>
      list.some((application) => application.id === created.id)
        ? replaceApplication(list, created)
        : [...list, created],
    );
    return created;
  }, []);

  const skip = useCallback(async (application: ApplicationView, reasonId: SkipReasonId) => {
    if (!application.clusterId) return;
    await createVacancySkip({ clusterId: application.clusterId, reasonId, origin: 'kanban' });
    setApplications((list) =>
      list.map((item) =>
        item.id === application.id
          ? { ...item, stage: 'archived', closedReason: reasonId, whoseTurn: null }
          : item,
      ),
    );
  }, []);

  return {
    status,
    applications,
    error,
    offline,
    failedChanges,
    conflicts,
    reload,
    refreshApplications,
    changeStage,
    scheduleInterview,
    retryStageChange,
    restoreFromArchive,
    markFollowUpSent,
    saveNote,
    addManualCard,
    skip,
  };
}

function without<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}
