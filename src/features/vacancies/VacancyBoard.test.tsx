import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VacancyBoard } from './VacancyBoard';

/**
 * Панель фильтров «Вакансий» — единственное место, где кандидат заводит
 * регулярную выборку (B181). Она обязана быть на экране и тогда, когда пул ещё
 * пуст: иначе первую выборку завести неоткуда.
 */
describe('VacancyBoard filters', () => {
  it('держит регулярные выборки в панели фильтров, пока пул ещё читается', () => {
    const html = renderToStaticMarkup(
      <VacancyBoard
        subscriptions={[]}
        defaultQuery="Руководитель продукта"
        onRefresh={vi.fn(async () => undefined)}
      />,
    );
    expect(html).toContain('Фильтры');
    expect(html).toContain('Регулярные выборки');
  });
});
