import { useCallback, useMemo, useState } from 'react';
import { letterScreenObject } from '../journey/consultantScreenObjects';
import { usePublishConsultantObject } from '../journey/consultantScreenTopic';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { ConnectionCircleNumber } from './vacancyLetterApi';
import type { VacancyLetterTarget } from './VacancyLetterScreen';

export interface VacancyLetterRouteRequest {
  readonly vacancy: VacancyLetterTarget;
  readonly initialCircle?: ConnectionCircleNumber;
}

export type CompanyLetterOpen = (
  vacancy: VacancyLetterTarget,
  circle: ConnectionCircleNumber,
) => void;

/** A row's letter: without a circle the controller picks the warmest known one. */
export type RowLetterOpen = (
  vacancy: MatchedVacancyItem['cluster'],
  circle?: ConnectionCircleNumber,
) => void;

export function useVacancyLetterRoute() {
  const [request, setRequest] = useState<VacancyLetterRouteRequest | null>(null);
  const openFromRow = useCallback<RowLetterOpen>(
    (vacancy, circle) => setRequest(circle ? { vacancy, initialCircle: circle } : { vacancy }),
    [],
  );
  const openFromCompany = useCallback<CompanyLetterOpen>(
    (vacancy, circle) => setRequest({ vacancy, initialCircle: circle }),
    [],
  );
  const close = useCallback(() => setRequest(null), []);
  // Открытое письмо для панели: о какой вакансии ход и что подсказывать (B511 Д5).
  const vacancyId = request?.vacancy.id;
  usePublishConsultantObject(
    useMemo(() => (vacancyId ? letterScreenObject(vacancyId) : null), [vacancyId]),
  );
  return { request, openFromRow, openFromCompany, close };
}
