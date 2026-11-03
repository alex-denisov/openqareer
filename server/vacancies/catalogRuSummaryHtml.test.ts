import { describe, expect, it } from 'vitest';
import { ruSummaryBlock } from './catalogRuSummaryHtml';

const summary = { text: 'Первое. Второе.', facts: {} };

describe('ruSummaryBlock', () => {
  it('names the board behind the salary without how it was read', () => {
    const html = ruSummaryBlock(summary, {
      salaryLabel: '71 000 — 74 000 $',
      sourceName: 'Himalayas (JSON API)',
    });
    expect(html).toContain('<dd>71 000 — 74 000 $ — по данным Himalayas</dd>');
    expect(html).not.toContain('JSON API');
    expect(
      ruSummaryBlock(summary, { salaryLabel: '100 000 ₽', sourceName: 'hh.ru (страница поиска)' }),
    ).toContain('<dd>100 000 ₽ — по данным hh.ru</dd>');
  });

  it('leaves the salary out when the card has none', () => {
    expect(ruSummaryBlock(summary, { sourceName: 'hh.ru' })).not.toContain('Зарплата');
  });
});
