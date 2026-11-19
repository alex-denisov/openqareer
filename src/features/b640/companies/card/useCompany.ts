import { useCallback, useEffect, useState } from 'react';
import type { CandidateCompanyDetails, CandidateCompanyVacancy } from '../../../../../shared/candidateCompany';
import { CoachApiError } from '../../../coach/apiClient';
import { getCandidateCompanyDetails } from '../../../vacancies/candidateCompaniesApi';

export type CompanyLoad = 'loading' | 'ready' | 'missing' | 'error';

export interface CompanyCard {
  readonly load: CompanyLoad;
  readonly details: CandidateCompanyDetails | undefined;
  readonly vacancies: readonly CandidateCompanyVacancy[];
  readonly moreBusy: boolean;
  readonly moreFailed: boolean;
  readonly retry: () => void;
  readonly loadMore: () => Promise<void>;
  readonly markWant: (key: string, want: boolean) => void;
}

const COMPANY_KEY = /^[a-f0-9]{24}$/u;

const isMissing = (error: unknown): boolean =>
  error instanceof CoachApiError && error.code === 'company_not_in_selection';

/** Карточка компании и её вакансии порциями по 20; чужой ключ адреса — «не нашли». */
export function useCompany(companyId: string): CompanyCard {
  const [details, setDetails] = useState<CandidateCompanyDetails | undefined>();
  const [vacancies, setVacancies] = useState<readonly CandidateCompanyVacancy[]>([]);
  const [load, setLoad] = useState<CompanyLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    if (!COMPANY_KEY.test(companyId)) {
      setLoad('missing');
      return undefined;
    }
    let live = true;
    setLoad('loading');
    getCandidateCompanyDetails(companyId)
      .then((read) => {
        if (!live) return;
        setDetails(read);
        setVacancies(read.vacancies);
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
    if (!details) return;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const read = await getCandidateCompanyDetails(companyId, vacancies.length);
      const known = new Set(vacancies.map((vacancy) => vacancy.id));
      setVacancies([...vacancies, ...read.vacancies.filter((vacancy) => !known.has(vacancy.id))]);
      setDetails(read);
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  }, [companyId, details, vacancies]);

  const markWant = useCallback((_key: string, want: boolean) => {
    setDetails((before) => (before ? { ...before, company: { ...before.company, want } } : before));
  }, []);

  return { load, details, vacancies, moreBusy, moreFailed, retry: () => setAttempt((value) => value + 1), loadMore, markWant };
}
