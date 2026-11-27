import { describe, expect, it } from 'vitest';
import { hhAboutText, plainEmployer, sourcedLines } from './hhAboutCleanup';

const about = [
  '🏆 I build technology organizations at Rosseti Digital (250+ specialists).',
  'Executive Leadership | P&L Ownership ($50M+) | Cloud',
  '📍 Based in Dubai | Open to global remote work and relocation',
  '📫 Contact: name@example.com | Telegram: @name',
  'Grew revenue to 920 million rubles and invented 77 products.',
].join('\n');

describe('B787: «О себе» для резюме hh.ru', () => {
  const text = hhAboutText(
    about,
    ['АО "Россети Цифра"'],
    ['250 специалистов', '$50M+', '920 млн руб.'],
  );

  it('без эмодзи, разделителей «|», контактов и утверждений о месте и переезде', () => {
    expect(text).not.toMatch(/[🏆📍📫|]|@|Dubai|relocation/u);
    expect(text).toContain('Executive Leadership, P&L Ownership ($50M+), Cloud');
  });

  it('компания — как в резюме hh.ru, без правовой формы', () => {
    expect(text).toContain('at Россети Цифра (250+ specialists)');
    expect(plainEmployer('АО "Россети Цифра"')).toBe('Россети Цифра');
  });

  it('предложение с числом без источника выпадает', () => {
    expect(text).not.toContain('77');
  });

  it('строки опыта — только с числами из источников', () => {
    expect(
      sourcedLines(['Team from 160 to 250.', 'Hired 31 people.'], ['со 160 до 250 человек']),
    ).toEqual(['Team from 160 to 250.']);
  });
});

describe('B787: название компании после перевода', () => {
  it('«Rosseti Tsifra» переводчика становится названием из резюме hh.ru', async () => {
    const { withHhEmployerNames } = await import('./hhAboutCleanup');
    const [edit] = withHhEmployerNames(
      [{ section: 'about', now: 'подразделения в Rosseti Tsifra, рост выручки' }],
      ['АО "Россети Цифра"'],
    );
    expect(edit!.now).toBe('подразделения в Россети Цифра, рост выручки');
  });
});
