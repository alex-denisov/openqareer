import { describe, expect, it } from 'vitest';
import { applyWays, type WaysInput } from './waysModel';

const hh = {
  sourceType: 'hh',
  sourceId: 'hh',
  sourceUrl: 'https://hh.ru/vacancy/1',
  observedAt: '2026-11-11',
};
const site = {
  sourceType: 'html',
  sourceId: 'co',
  sourceUrl: 'https://ladoga.example/jobs/1',
  observedAt: '2026-11-11',
};
const friend = {
  name: 'Роман Ефимов',
  sub: '1-й круг · работали вместе',
  label: 'Написать Роману',
};

function input(overrides: Partial<WaysInput> = {}): WaysInput {
  return { sources: [hh], primaryUrl: 'https://hh.ru/vacancy/1', ...overrides };
}

describe('applyWays', () => {
  it('источник hh.ru даёт способ «hh.ru» и ведёт в письмо', () => {
    expect(applyWays(input())).toEqual([
      {
        id: 'hh',
        title: 'hh.ru — письмо и ваше резюме',
        icon: 'responses',
        action: { kind: 'letter', label: 'Откликнуться на hh.ru' },
      },
    ]);
  });

  it('на проде hh приходит как json_api с sourceId hh — это тоже hh.ru', () => {
    const prod = {
      sourceType: 'json_api',
      sourceId: 'hh',
      sourceName: 'hh.ru',
      sourceUrl: 'https://hh.ru/vacancy/9',
      observedAt: '2026-11-11',
    };
    expect(
      applyWays(input({ sources: [prod], primaryUrl: prod.sourceUrl })).map((way) => way.id),
    ).toEqual(['hh']);
  });

  it('hh.ru узнаётся по адресу и по названию источника', () => {
    const byUrl = {
      sourceType: 'x',
      sourceId: 'y',
      sourceUrl: 'https://spb.hh.ru/vacancy/2',
      observedAt: '',
    };
    const byName = {
      sourceType: 'x',
      sourceId: 'y',
      sourceName: 'hh.ru (страница поиска)',
      sourceUrl: 'https://z.example/2',
      observedAt: '',
    };
    expect(
      applyWays(input({ sources: [byUrl], primaryUrl: byUrl.sourceUrl })).map((way) => way.id),
    ).toEqual(['hh']);
    expect(
      applyWays(input({ sources: [byName], primaryUrl: byName.sourceUrl })).map((way) => way.id),
    ).toContain('hh');
  });

  it('порядок макета: знакомый (рекомендуем), hh.ru, сайт', () => {
    const ways = applyWays(input({ sources: [hh, site], primaryUrl: site.sourceUrl, friend }));
    expect(ways.map((way) => way.id)).toEqual(['friend', 'hh', 'site']);
    expect(ways[0]).toMatchObject({
      title: 'Через знакомого — Роман Ефимов',
      sub: '1-й круг · работали вместе',
      recommended: true,
      action: { kind: 'compose', label: 'Написать Роману' },
    });
  });

  it('без знакомого hh.ru и сайт остаются', () => {
    const ways = applyWays(input({ sources: [hh, site], primaryUrl: site.sourceUrl }));
    expect(ways.map((way) => way.id)).toEqual(['hh', 'site']);
    expect(ways[1]).toMatchObject({
      title: 'Сайт компании',
      action: { kind: 'external', label: 'Открыть на сайте работодателя', url: site.sourceUrl },
    });
  });

  it('анкета работодателя: «анкета из N вопросов» и «Заполнить анкету»', () => {
    const ways = applyWays(input({ questionCount: 3 }));
    expect(ways.at(-1)).toMatchObject({
      id: 'site',
      title: 'Сайт компании — анкета из 3 вопросов',
      action: { kind: 'letter', label: 'Заполнить анкету' },
    });
    expect(applyWays(input({ questionCount: 21 })).at(-1)?.title).toContain('из 21 вопроса');
    expect(applyWays(input({ questionCount: 22 })).at(-1)?.title).toContain('из 22 вопросов');
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
