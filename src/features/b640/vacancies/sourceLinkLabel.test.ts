import { describe, expect, it } from 'vitest';
import { sourceLinkLabel } from './sourceLinkLabel';

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
});
