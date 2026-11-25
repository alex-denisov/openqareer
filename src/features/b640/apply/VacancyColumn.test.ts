import { describe, expect, it } from 'vitest';
import type { VacancyDetailState, VacancyDetailText } from '../../vacancies/vacancyDetailApi';
import { vacancyTextView } from './VacancyColumn';

function ready(detail: Partial<VacancyDetailText>): VacancyDetailState {
  return {
    status: 'ready',
    detail: { id: 'v', description: '', truncated: false, skills: [], responsibilities: [], ...detail },
  };
}

describe('текст вакансии слева (B798)', () => {
  it('полный текст главнее выжимки', () => {
    expect(vacancyTextView(ready({ description: 'Полный', summary: 'Выжимка' }), [])).toEqual({ kind: 'text', text: 'Полный' });
  });
  it('нет текста — выжимка, затем описание записи отклика', () => {
    expect(vacancyTextView(ready({ summary: 'Выжимка' }), ['Снимок'])).toEqual({ kind: 'text', text: 'Выжимка' });
    expect(vacancyTextView(ready({}), [null, 'Снимок'])).toEqual({ kind: 'text', text: 'Снимок' });
    expect(vacancyTextView({ status: 'failed' }, ['Снимок'])).toEqual({ kind: 'text', text: 'Снимок' });
  });
  it('колонка не бывает пустой молча', () => {
    expect(vacancyTextView(ready({ pending: true }), [])).toEqual({ kind: 'loading' });
    expect(vacancyTextView(ready({ textHidden: true }), [])).toEqual({ kind: 'hidden' });
    expect(vacancyTextView(ready({}), [])).toEqual({ kind: 'missing' });
    expect(vacancyTextView(ready({}), [], true)).toEqual({ kind: 'loading' });
  });
});
