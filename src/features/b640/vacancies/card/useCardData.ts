import { useCallback, useEffect, useState } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import { CoachApiError } from '../../../coach/apiClient';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';
import { getRecruiterContacts } from '../../../vacancies/recruiterContactsApi';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import { getVacancyConnectionCircles, type VacancyConnectionCircles } from '../../../vacancies/vacancyLetterApi';
import { getVacancyCard } from '../b640Api';
import { useVacancyLinks, type VacancyLinks } from '../vacancyLinks';

export type CardLoad = 'loading' | 'ready' | 'missing' | 'failed';

export interface CardData {
  readonly load: CardLoad;
  readonly item: MatchedVacancyItem | undefined;
  readonly campaign: CampaignMetaView | undefined;
  readonly rates: CurrencyRates | undefined;
  readonly links: VacancyLinks;
  /** Первый найденный рекрутёр; необязательный блок: нет данных — нет блока. */
  readonly recruiter: RecruiterContact | undefined;
  readonly circles: VacancyConnectionCircles | undefined;
  readonly reload: () => void;
}

/** Необязательные данные карточки: сбой чтения прячет блок, остальной экран не страдает. */
function useOptional<T>(load: () => Promise<T>, key: string): T | undefined {
  const [value, setValue] = useState<{ readonly key: string; readonly data: T }>();
  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setValue({ key, data }))
      .catch(() => alive && setValue(undefined));
    return () => {
      alive = false;
    };
    // load закрыт над key: меняется только вместе с ним.
  }, [key]);
  return value?.key === key ? value.data : undefined;
}

type SingleRead =
  | { readonly key: string; readonly state: 'loading' }
  | { readonly key: string; readonly state: 'ready'; readonly item: MatchedVacancyItem }
  | { readonly key: string; readonly state: 'missing' | 'failed' };

const GONE_CODES: ReadonlySet<string> = new Set(['vacancy_not_found', 'vacancy_gone']);

/**
 * B715: вакансии нет в загруженной подборке (ссылка hh.ru из «Своей вакансии», вакансия после
 * отклика, прямой адрес) — карточка читает её отдельно по тому же id.
 */
function useSingleVacancy(vacancyId: string, enabled: boolean): { readonly read: SingleRead | undefined; readonly retry: () => void } {
  const [read, setRead] = useState<SingleRead>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !vacancyId) return undefined;
    const controller = new AbortController();
    setRead({ key: vacancyId, state: 'loading' });
    getVacancyCard(vacancyId, controller.signal).then(
      (item) => setRead({ key: vacancyId, state: 'ready', item }),
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        const gone = reason instanceof CoachApiError && GONE_CODES.has(reason.code);
        setRead({ key: vacancyId, state: gone ? 'missing' : 'failed' });
      },
    );
    return () => controller.abort();
  }, [vacancyId, enabled, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { read: read?.key === vacancyId ? read : undefined, retry };
}

/** Сбой подборки не решает за карточку: отдельное чтение отвечает, есть ли вакансия. */
function cardLoad(item: MatchedVacancyItem | undefined, poolLoading: boolean, single: SingleRead | undefined): CardLoad {
  if (item) return 'ready';
  if (poolLoading || !single || single.state === 'loading') return 'loading';
  return single.state === 'failed' ? 'failed' : 'missing';
}

export function useCardData(vacancyId: string): CardData {
  const pool = useMatchedPool();
  const rates = useCurrencyRates();
  const links = useVacancyLinks();
  const pooled = pool.matched.find((entry) => entry.cluster.id === vacancyId);
  const single = useSingleVacancy(vacancyId, !pooled && !pool.loading);
  const item = pooled ?? (single.read?.state === 'ready' ? single.read.item : undefined);
  const contacts = useOptional(() => getRecruiterContacts(vacancyId), vacancyId);
  const circles = useOptional(() => getVacancyConnectionCircles(vacancyId), vacancyId);
  const reloadPool = pool.refresh;
  const reload = useCallback(() => {
    reloadPool?.();
    single.retry();
  }, [reloadPool, single.retry]);
  return {
    load: cardLoad(item, pool.loading, single.read),
    item,
    campaign: pool.campaign,
    rates,
    links,
    recruiter: contacts?.contacts.find((contact) => contact.fullName.trim() !== ''),
    circles,
    reload,
  };
}
