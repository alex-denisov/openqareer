import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  VacancyApplication,
  VacancyApplicationSnapshot,
  VacancyApplicationStatus,
} from '../../../shared/vacancyApplication';
import { getVacancyApplications, recordVacancyApplication } from '../coach/coachApi';
import { mergeApplication, optimisticApplication } from './vacancyApplicationState';

export interface VacancyApplications {
  readonly applications: readonly VacancyApplication[];
  readonly byCluster: ReadonlyMap<string, VacancyApplication>;
  /** Записи, которые не удалось сохранить: строка обязана сказать это вслух. */
  readonly unsaved: ReadonlySet<string>;
  readonly record: (
    clusterId: string,
    status: VacancyApplicationStatus,
    vacancy: VacancyApplicationSnapshot,
  ) => void;
}

/**
 * Ручные отклики кандидата в строке пула (B165, срез 1, узлы 6 и 8).
 *
 * Отклики читаются один раз на экран. Запись оптимистична: кандидат уходит на
 * площадку сразу по ссылке, и ждать ответа сервера, чтобы открыть вкладку,
 * нельзя. Если запись не прошла, состояние откатывается к прежнему и строка
 * говорит об этом: показывать подтверждённый отклик, которого в хранилище нет,
 * — это ровно то, что запрещает правило receipt.
 */
export function useVacancyApplications(
  provided?: readonly VacancyApplication[],
): VacancyApplications {
  const [applications, setApplications] = useState<readonly VacancyApplication[]>(
    provided ?? [],
  );
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (provided) return;
    let active = true;
    void getVacancyApplications()
      .then((list) => {
        if (active) setApplications(list);
      })
      // Откликов может не быть вовсе — это не ошибка экрана.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [provided]);

  const record = useCallback(
    (
      clusterId: string,
      status: VacancyApplicationStatus,
      vacancy: VacancyApplicationSnapshot,
    ) => {
      let previous: readonly VacancyApplication[] = [];
      setApplications((current) => {
        previous = current;
        return mergeApplication(current, optimisticApplication(clusterId, status, vacancy));
      });
      setUnsaved((current) => without(current, clusterId));
      void recordVacancyApplication({ clusterId, status, vacancy })
        .then((saved) => setApplications((current) => mergeApplication(current, saved)))
        .catch(() => {
          setApplications(previous);
          setUnsaved((current) => new Set(current).add(clusterId));
        });
    },
    [],
  );

  const byCluster = useMemo(
    () => new Map(applications.map((application) => [application.clusterId, application])),
    [applications],
  );

  return { applications, byCluster, unsaved, record };
}

function without(current: ReadonlySet<string>, clusterId: string): ReadonlySet<string> {
  if (!current.has(clusterId)) return current;
  const next = new Set(current);
  next.delete(clusterId);
  return next;
}
