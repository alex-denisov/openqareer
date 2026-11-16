import { describe, expect, it } from 'vitest';
import { applyWays, type WaysInput } from './waysModel';

const hh = { sourceType: 'hh', sourceId: 'hh', sourceUrl: 'https://hh.ru/vacancy/1', observedAt: '2026-11-11' };
const site = { sourceType: 'html', sourceId: 'co', sourceUrl: 'https://ladoga.example/jobs/1', observedAt: '2026-11-11' };

function input(overrides: Partial<WaysInput> = {}): WaysInput {
  return { sources: [hh], primaryUrl: 'https://hh.ru/vacancy/1', recruiterName: undefined, ...overrides };
}

describe('applyWays', () => {
  it('источник hh.ru даёт способ «hh.ru» и ведёт в письмо', () => {
    const ways = applyWays(input());
    expect(ways).toEqual([
      { id: 'hh', title: 'hh.ru — письмо и ваше резюме', action: { kind: 'letter', label: 'Откликнуться на hh.ru' } },
    ]);
  });

  it('другой источник — «Сайт компании» с внешней ссылкой', () => {
    const ways = applyWays(input({ sources: [hh, site], primaryUrl: site.sourceUrl }));
    expect(ways.map((way) => way.id)).toEqual(['hh', 'site']);
    expect(ways[1]).toMatchObject({
      title: 'Сайт компании',
      action: { kind: 'external', label: 'Открыть на сайте работодателя', url: site.sourceUrl },
    });
  });

  it('рекрутёр добавляет «Напрямую рекрутёру — Имя»', () => {
    const ways = applyWays(input({ recruiterName: 'Алина Громова' }));
    expect(ways.at(-1)).toMatchObject({
      id: 'direct',
      title: 'Напрямую рекрутёру — Алина Громова',
      action: { kind: 'letter', label: 'Откликнуться напрямую' },
    });
  });

  it('небезопасная ссылка не становится способом', () => {
    const bad = { ...site, sourceUrl: 'javascript:alert(1)' };
    expect(applyWays(input({ sources: [bad], primaryUrl: 'javascript:alert(1)' }))).toEqual([]);
  });

  it('без источника hh.ru только ссылка primaryUrl на чужой сайт', () => {
    const ways = applyWays(input({ sources: [], primaryUrl: 'https://ladoga.example/x' }));
    expect(ways.map((way) => way.id)).toEqual(['site']);
  });
});
