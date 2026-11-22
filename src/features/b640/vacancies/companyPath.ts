import { companyLookupKey } from '../../vacancies/vacancyScreenCollections';
import { buildNodePath } from '../routes';

/** Подпись строки, у вакансии которой источник не назвал компанию. */
export const NO_COMPANY = 'Компания не указана';

/**
 * Путь карточки компании v10b; `null` — компании нет (пустое имя или одни знаки):
 * ссылку не строим, `buildNodePath` без `companyId` бросает и роняет весь раздел.
 */
export function companyNodePath(name: string | null | undefined): string | null {
  const key = companyLookupKey(name ?? '');
  return key ? buildNodePath('v10b', { companyId: key }) : null;
}
