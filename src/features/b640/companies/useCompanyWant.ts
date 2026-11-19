import { useCallback, useState } from 'react';
import {
  removeCandidateCompanyWant,
  setCandidateCompanyWant,
} from '../../vacancies/candidateCompaniesApi';
import { useToast } from '../kit';

export interface WantTarget {
  readonly key: string;
  readonly name: string;
  readonly want: boolean;
}

export interface CompanyWant {
  /** Компания, чья отметка сейчас сохраняется. */
  readonly busyKey: string | null;
  /** Компания, чья отметка не сохранилась: строка ошибки с «Повторить» у неё. */
  readonly failed: WantTarget | null;
  readonly toggle: (target: WantTarget) => Promise<void>;
  readonly retry: () => void;
}

/**
 * «Хочу в компанию» и отмена. Отметку сохраняет сервер; после ответа строка меняется на месте
 * (`onChanged`), а тост даёт «Отменить» — то же действие в обратную сторону.
 */
export function useCompanyWant(onChanged: (key: string, want: boolean) => void): CompanyWant {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failed, setFailed] = useState<WantTarget | null>(null);

  const save = useCallback(
    async (target: WantTarget, withUndo: boolean): Promise<void> => {
      const next = !target.want;
      setBusyKey(target.key);
      setFailed(null);
      try {
        if (next) await setCandidateCompanyWant(target.key);
        else await removeCandidateCompanyWant(target.key);
        onChanged(target.key, next);
        if (withUndo) {
          toast.show({
            text: next ? `${target.name} — в списке «Хочу»` : `${target.name} убрана из «Хочу»`,
            undo: { label: 'Отменить', onUndo: () => void save({ ...target, want: next }, false) },
          });
        }
      } catch {
        setFailed(target);
      } finally {
        setBusyKey(null);
      }
    },
    [onChanged, toast],
  );

  const toggle = useCallback((target: WantTarget) => save(target, true), [save]);
  const retry = useCallback(() => {
    if (failed) void save(failed, true);
  }, [failed, save]);

  return { busyKey, failed, toggle, retry };
}
