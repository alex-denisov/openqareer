import { useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { appliedOn, isSaved, type VacancyLinks } from '../vacancyLinks';

export interface SaveModel {
  /** Нет, если по вакансии уже есть отклик: сохранять нечего. */
  readonly button: { readonly saved: boolean; readonly busy: boolean; readonly onToggle: () => void } | null;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** «Сохранить» с ожиданием и ошибкой на месте. */
export function useSave(item: MatchedVacancyItem, links: VacancyLinks): SaveModel {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const application = links.byCluster.get(item.cluster.id);

  const toggle = (): void => {
    setBusy(true);
    setFailed(false);
    links
      .toggleSaved(item.cluster)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  return {
    button: appliedOn(application) ? null : { saved: isSaved(application), busy, onToggle: toggle },
    failed,
    retry: toggle,
  };
}
