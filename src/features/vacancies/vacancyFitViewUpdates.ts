import { useEffect, useState } from 'react';
import type { VacancyFitView } from '../../../shared/vacancyFit';
const EVENT = 'openqareer:vacancy-fit-read';
interface FitUpdate {
  readonly vacancyId: string;
  readonly view: VacancyFitView;
}
/** In-memory notification only; no cross-session/global result cache. */
export function publishVacancyFitRead(vacancyId: string, view: VacancyFitView) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent<FitUpdate>(EVENT, { detail: { vacancyId, view } }));
}
export function useLatestVacancyFitView(
  vacancyId: string | undefined,
  initialView: VacancyFitView | undefined,
) {
  const [received, setReceived] = useState<FitUpdate>();
  useEffect(() => {
    if (!vacancyId) return;
    const update = (event: Event) => {
      const detail = (event as CustomEvent<FitUpdate>).detail;
      if (detail.vacancyId === vacancyId) setReceived(detail);
    };
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, [vacancyId]);
  useEffect(() => setReceived(undefined), [vacancyId, initialView]);
  return received && received.vacancyId === vacancyId ? received.view : initialView;
}
