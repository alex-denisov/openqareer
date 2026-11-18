import { useCallback, useEffect, useRef, useState } from 'react';
import type { OwnVacancy, OwnVacancyUnreadable } from '../../../../../shared/b640OwnVacancy';
import { buildNodePath } from '../../routes';
import { useShell } from '../../shell/ShellContext';
import { createOwnVacancy, deleteOwnVacancy, listOwnVacancies, ownVacancySource } from '../ownVacancyApi';

/** Что панель показывает под полем. */
export type OwnAddStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'unreadable'; readonly reason: OwnVacancyUnreadable }
  | { readonly kind: 'limit' }
  | { readonly kind: 'error' };

export interface OwnVacancies {
  readonly items: readonly OwnVacancy[];
  readonly status: OwnAddStatus;
  readonly add: (value: string) => Promise<boolean>;
  readonly remove: (id: string) => Promise<void>;
  readonly resetStatus: () => void;
}

const POLL_MS = 10_000;
const POLL_MAX = 30;

function usePollWhileComparing(items: readonly OwnVacancy[], reload: () => void): void {
  const rounds = useRef(0);
  const comparing = items.some((item) => item.comparing);
  useEffect(() => {
    if (!comparing) { rounds.current = 0; return undefined; }
    if (rounds.current >= POLL_MAX) return undefined;
    const timer = setTimeout(() => { rounds.current += 1; reload(); }, POLL_MS);
    return () => clearTimeout(timer);
  }, [comparing, items, reload]);
}

/** B676: свои вакансии кандидата — список, добавление по ссылке или тексту, удаление. */
export function useOwnVacancies(): OwnVacancies {
  const { navigate } = useShell();
  const [items, setItems] = useState<readonly OwnVacancy[]>([]);
  const [status, setStatus] = useState<OwnAddStatus>({ kind: 'idle' });
  const reload = useCallback(() => {
    listOwnVacancies().then(setItems, () => undefined);
  }, []);
  useEffect(reload, [reload]);
  usePollWhileComparing(items, reload);
  const add = useCallback(async (value: string) => {
    setStatus({ kind: 'reading' });
    try {
      const result = await createOwnVacancy(ownVacancySource(value));
      if (result.outcome === 'created') {
        setItems((current) => [result.vacancy, ...current.filter((item) => item.id !== result.vacancy.id)]);
        setStatus({ kind: 'idle' });
        return true;
      }
      if (result.outcome === 'in_pool') {
        setStatus({ kind: 'idle' });
        navigate(buildNodePath('v04', { vacancyId: result.clusterId }));
        return true;
      }
      setStatus(result.outcome === 'limit' ? { kind: 'limit' } : { kind: 'unreadable', reason: result.reason });
      return false;
    } catch {
      setStatus({ kind: 'error' });
      return false;
    }
  }, [navigate]);
  const remove = useCallback(async (id: string) => {
    await deleteOwnVacancy(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const resetStatus = useCallback(() => setStatus({ kind: 'idle' }), []);
  return { items, status, add, remove, resetStatus };
}
