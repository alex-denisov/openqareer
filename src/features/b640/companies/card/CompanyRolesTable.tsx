import { useMemo, useState } from 'react';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { useVacancyLinks } from '../../vacancies/vacancyLinks';
import { SERVER_SORT, nextSort, sortItems, type SortState } from '../../vacancies/list/sortModel';
import { TableBlock } from '../../vacancies/list/TableBlock';
import { useRowInteractions } from '../../vacancies/list/useRowInteractions';

/**
 * B655, v10b на 1440: «Вакансии компании по вашим ролям» — та же таблица, что в подборке s07:
 * сортировка по столбцам, курс ЦБ у «Денег», раскрытие строки со ссылкой на карточку вакансии.
 */
export function CompanyRolesTable({ vacancies }: { readonly vacancies: readonly MatchedVacancyItem[] }) {
  const links = useVacancyLinks();
  const rates = useCurrencyRates();
  const rows = useRowInteractions(links);
  const [sortState, setSortState] = useState<SortState | null>(null);
  const items = useMemo(
    () => sortItems(vacancies.filter((item) => !rows.hiddenIds.has(item.cluster.id)), sortState, rates),
    [vacancies, rows.hiddenIds, sortState, rates],
  );
  const env = { currency: 'RUB' as const, rates, noRole: false };
  return (
    <div className="vt-wrap co-vtable">
      <TableBlock
        items={items}
        env={env}
        sort={sortState ?? SERVER_SORT}
        onSort={(key) => setSortState((current) => nextSort(current ?? SERVER_SORT, key))}
        links={links}
        rows={rows}
        rates={rates}
      />
    </div>
  );
}
