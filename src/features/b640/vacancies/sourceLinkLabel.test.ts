import { describe, expect, it } from 'vitest';
import { sourceLinkLabel, sourceLinkTarget } from './sourceLinkLabel';

const telegram = {
  sourceType: 'telegram',
  sourceId: 'tg-it_vakansii_udalenka',
  sourceName: 'IT вакансии удалёнка',
  sourceUrl: 'https://t.me/it_vakansii_udalenka/2838',
};

/** B726 (B645, прод 23.11): меню строки звало пост Telegram «сайтом работодателя». */
describe('sourceLinkLabel: ссылка вакансии называется тем, куда ведёт', () => {
  it('пост Telegram — «Открыть пост в Telegram»', () => {
    expect(
      sourceLinkLabel({
        primaryUrl: telegram.sourceUrl,
        sources: [telegram],
        canonicalCompany: '',
      }),
    ).toBe('Открыть пост в Telegram');
  });

  it('Telegram узнаётся по адресу и с компанией', () => {
    expect(
      sourceLinkLabel({
        primaryUrl: 'https://t.me/jobs/1',
        sources: [],
        canonicalCompany: 'Ладога',
      }),
    ).toBe('Открыть пост в Telegram');
  });

  it('без компании — по имени источника, без имени — по адресу сайта', () => {
    const board = {
      sourceType: 'html',
      sourceName: 'Himalayas',
      sourceUrl: 'https://himalayas.app/jobs/1',
    };
    expect(
      sourceLinkLabel({ primaryUrl: board.sourceUrl, sources: [board], canonicalCompany: '' }),
    ).toBe('Открыть на Himalayas');
    expect(
      sourceLinkLabel({
        primaryUrl: 'https://www.jobs.example/1',
        sources: [],
        canonicalCompany: null,
      }),
    ).toBe('Открыть на jobs.example');
  });

  it('с компанией — сайт работодателя, как раньше', () => {
    expect(
      sourceLinkLabel({
        primaryUrl: 'https://ladoga.example/jobs/1',
        sources: [],
        canonicalCompany: 'Ладога',
      }),
    ).toBe('Открыть на сайте работодателя');
  });

  it('карточка называет свою ссылку, а не основную: второй источник и пост по типу', () => {
    const hh = { sourceType: 'hh', sourceUrl: 'https://hh.ru/vacancy/1' };
    const board = {
      sourceType: 'html',
      sourceName: 'Himalayas',
      sourceUrl: 'https://himalayas.app/j/1',
    };
    const tg = { sourceType: 'telegram', sourceUrl: 'https://tg.example/p/1' };
    const base = { primaryUrl: hh.sourceUrl, sources: [hh, board, tg], canonicalCompany: '' };
    expect(sourceLinkLabel({ ...base, url: board.sourceUrl })).toBe('Открыть на Himalayas');
    expect(sourceLinkTarget({ ...base, url: board.sourceUrl })).toEqual({
      kind: 'source',
      name: 'Himalayas',
    });
    expect(sourceLinkTarget({ ...base, url: tg.sourceUrl })).toEqual({ kind: 'telegram' });
    expect(sourceLinkTarget({ ...base, url: tg.sourceUrl, canonicalCompany: 'Ладога' })).toEqual({
      kind: 'telegram',
    });
    expect(sourceLinkTarget({ ...base, url: board.sourceUrl, canonicalCompany: 'Ладога' })).toEqual(
      {
        kind: 'employer',
      },
    );
  });
});
