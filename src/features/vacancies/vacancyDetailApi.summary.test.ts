import { expect, it } from 'vitest';
import { vacancySummaryText } from './vacancyDetailApi';

it('uses the page summary first, then the detail summary, and is honest while loading (B446-g4)', () => {
  expect(vacancySummaryText('Из страницы', { status: 'loading' })).toEqual({ text: 'Из страницы' });
  const detail = { id: 'c', description: 'x', truncated: false, skills: [], responsibilities: [] };
  expect(
    vacancySummaryText('', { status: 'ready', detail: { ...detail, summary: 'Из карточки' } }),
  ).toEqual({
    text: 'Из карточки',
  });
  expect(vacancySummaryText('', { status: 'loading' })).toEqual({ loading: true });
  expect(vacancySummaryText('', { status: 'ready', detail })).toEqual({});
  expect(vacancySummaryText('', { status: 'failed' })).toEqual({});
});
