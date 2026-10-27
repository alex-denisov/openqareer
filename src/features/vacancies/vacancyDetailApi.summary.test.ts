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

it('falls back to the opening of the full text when neither summary exists (26.10, Autodesk)', () => {
  const description = [
    'Job Requisition ID #',
    '26WD101358',
    'Position Overview',
    'Autodesk is looking for an experienced Engineering Manager to lead a high-performing engineering team within the Enterprise Technology organization.',
    'In this role, you will lead, hire, develop, and grow a team of talented engineers while remaining closely connected to the technology.',
  ].join('\n\n');
  const detail = { id: 'c', description, truncated: false, skills: [], responsibilities: [] };
  const result = vacancySummaryText('', { status: 'ready', detail });
  expect(result.text).toMatch(/^Autodesk is looking for an experienced Engineering Manager/);
  expect(result.text).not.toContain('Requisition');
  expect(result.text!.length).toBeLessThanOrEqual(420);
});

it('убирает ссылки markdown из выжимки, оставляя подпись (27.10)', () => {
  expect(
    vacancySummaryText('OUR PURPOSE [https://docs.google.com/drawings/d/1F] We build', {
      status: 'idle',
    }),
  ).toEqual({ text: 'OUR PURPOSE We build' });
  expect(
    vacancySummaryText('See [our values](https://x.io/v) and ![logo](https://x.io/l.png).', {
      status: 'idle',
    }),
  ).toEqual({ text: 'See our values and .' });
});
