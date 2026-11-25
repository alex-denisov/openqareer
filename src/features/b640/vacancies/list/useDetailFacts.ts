import { useEffect, useState } from 'react';
import { getDecisionProfile } from '../../../coach/coachApi';
import { companyLookupKey } from '../../../vacancies/vacancyScreenCollections';
import { getB640Company, type CompanyCard } from '../../companies/companiesApi';
import type { Expectation } from '../card/moneyScale';

/** Необязательное чтение сводки: сбой — без этой части строки. */
function useOptionalRead<T>(key: string, load: () => Promise<T>): T | undefined {
  const [value, setValue] = useState<{ readonly key: string; readonly data: T }>();
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    load().then(
      (data) => alive && setValue({ key, data }),
      () => alive && setValue(undefined),
    );
    return () => {
      alive = false;
    };
    // load закрыт над key.
  }, [key]);
  return value?.key === key ? value.data : undefined;
}

/** Карточка компании раскрытой строки: отрасль и откуда сведения. */
export function useDetailCompany(company: string): CompanyCard | undefined {
  const id = company ? companyLookupKey(company) || company : '';
  return useOptionalRead(id, () => getB640Company(id));
}

/** Ожидания кандидата («Зарплата от» профиля). */
export function useExpectation(): Expectation | undefined {
  const profile = useOptionalRead('profile', () => getDecisionProfile());
  const amount = profile?.salaryFloor;
  return amount && amount > 0 ? { amount, currency: profile.salaryCurrency ?? 'RUB' } : undefined;
}
