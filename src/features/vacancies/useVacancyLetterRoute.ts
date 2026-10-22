import { useCallback, useState } from 'react';
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
  return { request, openFromRow, openFromCompany, close };
}
