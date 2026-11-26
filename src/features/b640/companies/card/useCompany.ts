import { useCallback, useEffect, useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { CoachApiError } from '../../../coach/apiClient';
import { getB640Company, type CompanyCard as CompanyData } from '../companiesApi';

export type CompanyLoad = 'loading' | 'ready' | 'missing' | 'error';

export interface CompanyCard {
  readonly load: CompanyLoad;
  readonly details: CompanyData | undefined;
  readonly vacancies: readonly MatchedVacancyItem[];
  readonly moreBusy: boolean;
  readonly moreFailed: boolean;
  readonly retry: () => void;
  readonly loadMore: () => Promise<void>;
  readonly markWant: (key: string, want: boolean) => void;
}

const isMissing = (error: unknown): boolean =>
  error instanceof CoachApiError && error.code === 'company_not_in_selection';

function appendRows(rows: readonly MatchedVacancyItem[], next: readonly MatchedVacancyItem[]): MatchedVacancyItem[] {
  const known = new Set(rows.map((row) => row.cluster.id));
  return [...rows, ...next.filter((row) => !known.has(row.cluster.id))];
}

/** Карточка компании (по хеш-ключу или названию) и её вакансии по ролям порциями по 20. */
export function useCompany(companyId: string): CompanyCard {
  const [details, setDetails] = useState<CompanyData | undefined>();
  const [vacancies, setVacancies] = useState<readonly MatchedVacancyItem[]>([]);
  const [load, setLoad] = useState<CompanyLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    if (!companyId.trim()) {
      setLoad('missing');
      return undefined;
    }
    let live = true;
    setLoad('loading');
    getB640Company(companyId)
      .then((read) => {
        if (!live) return;
        setDetails(read);
        setVacancies(read.roleVacancies);
        setLoad('ready');
      })
      .catch((error: unknown) => {
        if (live) setLoad(isMissing(error) ? 'missing' : 'error');
      });
    return () => {
      live = false;
    };
  }, [companyId, attempt]);

  const loadMore = useCallback(async () => {
    if (!details?.roleNextOffset) return;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const read = await getB640Company(companyId, details.roleNextOffset);
      setVacancies((before) => appendRows(before, read.roleVacancies));
      setDetails({ ...read, applications: { ...details.applications, ...read.applications } });
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }, [companyId, details]);

  const markWant = useCallback((_key: string, want: boolean) => {
    setDetails((before) => (before ? { ...before, company: { ...before.company, want } } : before));
  }, []);

  return { load, details, vacancies, moreBusy, moreFailed, retry: () => setAttempt((value) => value + 1), loadMore, markWant };
}
