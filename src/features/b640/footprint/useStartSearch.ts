import { useState } from 'react';
import { CoachApiError } from '../../coach/apiClient';
import { grantAccountCapabilityConsent, startCandidateFootprintAudit } from './footprintApi';
import { announceFootprintChanged, type FootprintData } from './useFootprint';
import { reportFailure } from './reportFailure';

export interface StartSearch {
  readonly busy: boolean;
  readonly error: string | null;
  readonly start: (ids: readonly string[]) => Promise<void>;
}

const START_FAILED = 'Не удалось начать поиск.';

function startError(reason: unknown): string {
  // Тексты ошибок сервера написаны для кандидата; прочие сбои — общая строка.
  return reason instanceof CoachApiError && reason.message ? reason.message : START_FAILED;
}

/** Повторная проверка берёт прежний выбор, если он ещё есть в плане. */
export function repeatIds(data: FootprintData): readonly string[] {
  const inPlan = new Set(data.plan.filter((item) => item.available).map((item) => item.id));
  const previous = (data.audit?.selectedQueryIds ?? []).filter((id) => inPlan.has(id));
  if (previous.length > 0) return previous;
  return data.plan.filter((item) => item.available && item.selectedByDefault).map((item) => item.id);
}

/** «Начать поиск» и «Проверить снова»: при необходимости даём согласие, затем запускаем. */
export function useStartSearch(data: FootprintData, onStarted: () => void): StartSearch {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(ids: readonly string[]) {
    if (ids.length === 0) {
      setError('Отметьте хотя бы одни данные для поиска.');
      return;
    }
    setBusy(true);
    setError(null);
    let granted = false;
    try {
      if (!data.consentGranted) {
        await grantAccountCapabilityConsent('digital_footprint', data.consentVersion);
        granted = true;
      }
      await startCandidateFootprintAudit(ids);
      onStarted();
    } catch (reason) {
      reportFailure('поиск следа не начался', reason);
      setError(startError(reason));
      // Согласие уже сохранено: перечитываем, чтобы повтор не выдавал его снова.
      if (granted) announceFootprintChanged();
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, start };
}
