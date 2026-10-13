import { useState } from 'react';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { VacancyApplicationSnapshot } from '../../../shared/vacancyApplication';
import type { VacancyApplications } from './useVacancyApplications';
import { vacancySnapshot } from './VacancyRowElements';

export function useVacancyRowApplied(
  cluster: MatchedVacancyItem['cluster'],
  onMarkAlreadyApplied?: (clusterId: string, vacancy: VacancyApplicationSnapshot) => Promise<void>,
  recordConfirmed?: VacancyApplications['recordConfirmed'],
) {
  const [savingApplied, setSavingApplied] = useState(false);
  const [appliedError, setAppliedError] = useState<string>();

  const handleConfirmAlreadyApplied = async () => {
    if (!onMarkAlreadyApplied) return;
    setSavingApplied(true);
    setAppliedError(undefined);
    try {
      await onMarkAlreadyApplied(cluster.id, vacancySnapshot(cluster));
    } catch {
      setAppliedError('Не удалось сохранить отклик. Состояние не изменено.');
    } finally {
      setSavingApplied(false);
    }
  };

  const handleConfirmSent = async () => {
    if (!recordConfirmed) return;
    setSavingApplied(true);
    setAppliedError(undefined);
    try {
      await recordConfirmed(cluster.id, 'applied', vacancySnapshot(cluster));
    } catch {
      setAppliedError('Не удалось сохранить отклик. Состояние не изменено.');
    } finally {
      setSavingApplied(false);
    }
  };

  return {
    savingApplied,
    appliedError,
    handleConfirmAlreadyApplied,
    handleConfirmSent,
  };
}
