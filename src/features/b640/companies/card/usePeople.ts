import { useEffect, useState } from 'react';
import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { getB640CompanyPeople } from '../companiesApi';

export type PeopleLoad = 'loading' | 'ready' | 'error';

export interface CompanyPeopleState {
  readonly load: PeopleLoad;
  readonly people: readonly B640CompanyPerson[];
  readonly total: number;
  readonly retry: () => void;
}

/** Люди компании отдельным запросом: карточка не ждёт кругов знакомых. */
export function usePeople(companyId: string, enabled: boolean): CompanyPeopleState {
  const [people, setPeople] = useState<readonly B640CompanyPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [load, setLoad] = useState<PeopleLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setLoad('loading');
    getB640CompanyPeople(companyId)
      .then((page) => {
        if (!live) return;
        setPeople(page.items);
        setTotal(page.total);
        setLoad('ready');
      })
      .catch(() => {
        if (live) setLoad('error');
      });
    return () => {
      live = false;
    };
  }, [companyId, enabled, attempt]);
  return { load, people, total, retry: () => setAttempt((value) => value + 1) };
}
