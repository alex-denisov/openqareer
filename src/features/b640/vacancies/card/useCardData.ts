import { useCallback, useEffect, useState } from 'react';
import type { CurrencyRates } from '../../../../../shared/currencyRates';
import { isHhSource } from '../../../../../shared/hhVacancySource';
import type { RecruiterContact } from '../../../../../shared/recruiterContact';
import { CoachApiError } from '../../../coach/apiClient';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import type { CampaignMetaView } from '../../../coach/matchedVacancyApi';
import { getRecruiterContacts } from '../../../vacancies/recruiterContactsApi';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { useMatchedPool } from '../../../vacancies/useMatchedPool';
import {
  getVacancyConnectionCircles,
  type VacancyConnectionCircles,
} from '../../../vacancies/vacancyLetterApi';
import type { HhResumeFitStatus } from '../../../../../shared/hhCandidateSession';
import type { B640CompanyPeoplePage } from '../../../../../shared/b640Companies';
import type { ApplicationQuestionnaire } from '../../../../../shared/applicationQuestionnaire';
import { getDecisionProfile } from '../../../coach/coachApi';
import { getQuestionnaire } from '../../apply/data/questionnaireApi';
import { getHhResumeReview, getHhResumes } from '../../apply/hh/hhSessionApi';
import {
  getB640Company,
  getB640CompanyPeople,
  type CompanyCard,
} from '../../companies/companiesApi';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { getVacancyCard } from '../b640Api';
import type { Expectation } from './moneyScale';
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
  /** Карточка компании B677: отрасль, город, число вакансий. */
  readonly company: CompanyCard | undefined;
  readonly people: B640CompanyPeoplePage | undefined;
  readonly questionnaire: ApplicationQuestionnaire | undefined;
  /** Ожидания из профиля («Зарплата от»). */
  readonly expectation: Expectation | undefined;
  /** Название выбранного резюме hh.ru. */
  readonly hhResumeTitle: string | null | undefined;
  /** Подходит ли выбранное резюме hh.ru вакансии (B678). */
  readonly hhResumeFit: HhResumeFitStatus | undefined;
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
 * отклика, прямой адрес) — карточка читает её отдельно по тому же id. B654: и пока подборка
 * ещё читается — карточка не ждёт её страниц.
 */
function useSingleVacancy(
  vacancyId: string,
  enabled: boolean,
): { readonly read: SingleRead | undefined; readonly retry: () => void } {
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

/** Строка подборки со склейкой hh.ru и других площадок: чья это запись hh.ru, знает карточка. */
function hasGluedHh(item: MatchedVacancyItem | undefined): boolean {
  const sources = item?.cluster.sources ?? [];
  return sources.length > 1 && sources.some(isHhSource);
}

/** Площадки строки — сверенные сервером; до ответа hh.ru в склейке не показывается (B787). */
function withOwnSources(
  pooled: MatchedVacancyItem | undefined,
  single: SingleRead | undefined,
): MatchedVacancyItem | undefined {
  const own = single?.state === 'ready' ? single.item : undefined;
  if (!pooled || !hasGluedHh(pooled)) return pooled ?? own;
  const sources =
    own?.cluster.sources ?? pooled.cluster.sources.filter((source) => !isHhSource(source));
  const primaryUrl = own?.cluster.primaryUrl ?? pooled.cluster.primaryUrl;
  return { ...pooled, cluster: { ...pooled.cluster, sources, primaryUrl } };
}

/** Сбой подборки не решает за карточку: отдельное чтение отвечает, есть ли вакансия. */
function cardLoad(
  item: MatchedVacancyItem | undefined,
  poolLoading: boolean,
  single: SingleRead | undefined,
): CardLoad {
  if (item) return 'ready';
  if (poolLoading || !single || single.state === 'loading') return 'loading';
  return single.state === 'failed' ? 'failed' : 'missing';
}

function expectationOf(
  amount: number | undefined,
  currency: string | undefined,
): Expectation | undefined {
  return amount && amount > 0 ? { amount, currency: currency ?? 'RUB' } : undefined;
}

export function useCardData(vacancyId: string): CardData {
  const pool = useMatchedPool();
  const rates = useCurrencyRates();
  const links = useVacancyLinks();
  const pooled = pool.matched.find((entry) => entry.cluster.id === vacancyId);
  // B654: не ждём подборку (страницами — секунды): своя вакансия одним запросом по id.
  const single = useSingleVacancy(vacancyId, !pooled || hasGluedHh(pooled));
  const item = withOwnSources(pooled, single.read);
  const contacts = useOptional(() => getRecruiterContacts(vacancyId), vacancyId);
  const circles = useOptional(() => getVacancyConnectionCircles(vacancyId), vacancyId);
  const company = item?.cluster.canonicalCompany ?? '';
  const companyId = company ? companyLookupKey(company) || company : '';
  const companyCard = useOptional(
    () => (companyId ? getB640Company(companyId) : Promise.resolve(undefined)),
    companyId,
  );
  const people = useOptional(
    () => (companyId ? getB640CompanyPeople(companyId) : Promise.resolve(undefined)),
    companyId,
  );
  const questionnaire = useOptional(() => getQuestionnaire(vacancyId), vacancyId);
  const profile = useOptional(() => getDecisionProfile(), 'profile');
  const hhResumes = useOptional(() => getHhResumes(undefined, vacancyId), vacancyId);
  const hhReview = useOptional(() => getHhResumeReview(vacancyId), vacancyId);
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
    company: companyCard,
    people,
    questionnaire,
    expectation: expectationOf(profile?.salaryFloor, profile?.salaryCurrency),
    hhResumeTitle: hhResumes === undefined ? undefined : (hhResumes?.selected?.title ?? null),
    hhResumeFit: hhReview?.resumes.find((entry) => entry.resumeId === hhResumes?.selected?.id)
      ?.status,
    reload,
  };
}
