import { useEffect, useState } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';
import { getRecruiterContacts } from '../../../vacancies/recruiterContactsApi';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import { getVacancyConnectionCircles, type VacancyConnectionCircles } from '../../../vacancies/vacancyLetterApi';
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

function cardLoad(item: MatchedVacancyItem | undefined, loading: boolean, failed: boolean): CardLoad {
  if (item) return 'ready';
  if (loading) return 'loading';
  return failed ? 'failed' : 'missing';
}

export function useCardData(vacancyId: string): CardData {
  const pool = useMatchedPool();
  const rates = useCurrencyRates();
  const links = useVacancyLinks();
  const item = pool.matched.find((entry) => entry.cluster.id === vacancyId);
  const contacts = useOptional(() => getRecruiterContacts(vacancyId), vacancyId);
  const circles = useOptional(() => getVacancyConnectionCircles(vacancyId), vacancyId);
  return {
    load: cardLoad(item, pool.loading, pool.failed),
    item,
    campaign: pool.campaign,
    rates,
    links,
    recruiter: contacts?.contacts.find((contact) => contact.fullName.trim() !== ''),
    circles,
    reload: pool.refresh ?? (() => undefined),
  };
}
