import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VacancyFitOrderNote } from './VacanciesResultCount';

describe('VacancyFitOrderNote', () => {
  it('says the rule of the order in the words the owner chose', () => {
    expect(renderToStaticMarkup(<VacancyFitOrderNote />)).toContain(
      'Внутри одного цвета процента сначала ваши роли. Вакансии с малым числом требований ниже.',
    );
  });
});
