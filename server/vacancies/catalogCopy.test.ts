import { describe, expect, it } from 'vitest';
import { countLabel, formatRuDate, normalizeSalaryLabel, pageFacts } from './catalogCopy';

const entry = (over: Partial<Parameters<typeof pageFacts>[1][number]> = {}) => ({
  company: 'Acme',
  isRemote: false,
  skills: ['SQL', 'Python'],
  lastSeenAt: '2026-10-19T10:00:00.000Z',
  ...over,
});

describe('countLabel', () => {
  it('declines the noun by the number', () => {
    expect(countLabel(1)).toBe('1 вакансия');
    expect(countLabel(24)).toBe('24 вакансии');
    expect(countLabel(11)).toBe('11 вакансий');
    expect(countLabel(155000)).toBe('155 000 вакансий');
  });
});

describe('pageFacts', () => {
  it('counts over the page and names the sample', () => {
    const facts = pageFacts(40, [
      entry({ salaryLabel: '200 000 ₽', isRemote: true }),
      entry({ company: 'Beta', lastSeenAt: '2026-10-20T08:00:00.000Z' }),
      entry({ skills: ['Go'] }),
    ]);
    expect(facts[0]).toBe(
      'В разделе 40 вакансий. Из 3 на этой странице: с указанной зарплатой — 1, удалённых — 1, работодателей — 2.',
    );
    expect(facts[1]).toBe('Частые метки в вакансиях: Python, SQL.');
    expect(facts[2]).toBe(`Данные проверены ${formatRuDate('2026-10-20')}.`);
  });

  it('says «всех» when the page holds the whole section and skips rare skills', () => {
    const facts = pageFacts(1, [entry()]);
    expect(facts[0]).toContain('Из всех:');
    expect(facts.some((fact) => fact.startsWith('Чаще всего'))).toBe(false);
  });

  it('returns nothing for an empty page', () => {
    expect(pageFacts(0, [])).toEqual([]);
  });
});

describe('normalizeSalaryLabel', () => {
  it('swaps currency codes for signs and folds equal ends', () => {
    expect(normalizeSalaryLabel('1\u00a0500 — 2\u00a0999 USD')).toBe('1\u00a0500 — 2\u00a0999 $');
    expect(normalizeSalaryLabel('125\u00a0000 — 125\u00a0000 RUR')).toBe('125\u00a0000 ₽');
    expect(normalizeSalaryLabel('от 90\u00a0000 ₽')).toBe('от 90\u00a0000 ₽');
    expect(normalizeSalaryLabel('100 — 200 XYZ')).toBe('100 — 200 XYZ');
  });
});
