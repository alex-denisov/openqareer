import { describe, expect, it } from 'vitest';
import { gateIntro, humanDate } from '../seo/listingIntroText';
import intros from '../seo/data/listingIntros.json';
import { listingIntroBlock, listingIntroFor, salaryLine } from './catalogListingIntro';

const facts = { vacancies: 37, companiesCount: 30, topSkills: [{ skill: 'Java', vacancies: 12 }] };

describe('gateIntro', () => {
  it('drops every money sentence and rewrites the ISO date', () => {
    const gate = gateIntro(
      'На 2026-11-08 открыто 37 вакансий. По 8 вакансиям с указанной зарплатой вилка 150000–180000 USD.\n\n' +
        'Java просят в 12 вакансиях. Нижняя граница выборки равна 4000 USD. Работодатели редко указывают доход.',
      facts,
      '2026-11-08',
    );
    expect(gate.paragraphs).toEqual([
      'На 8 ноября 2026 года открыто 37 вакансий.',
      'Java просят в 12 вакансиях.',
    ]);
    expect(gate.unknownNumbers).toEqual([]);
  });

  it('reports numbers the facts do not contain', () => {
    expect(gateIntro('Компании ищут 45 человек.', facts, '2026-11-08').unknownNumbers).toEqual([
      '45',
    ]);
    expect(gateIntro('Срез 08.11: 37 вакансий.', facts, '2026-11-08').unknownNumbers).toEqual([]);
  });

  it('writes Russian dates', () => {
    expect(humanDate('2026-11-08')).toBe('8 ноября 2026 года');
  });
});

describe('published intros', () => {
  it('carry no money words and only per-period salary groups of at least 5', () => {
    expect(intros.length).toBeGreaterThan(1000);
    for (const intro of intros) {
      expect(intro.paragraphs.join(' ')).not.toMatch(/зарплат|вилк|₽|\$|€|\bUSD\b/u);
      for (const range of intro.salary) {
        expect(['hour', 'month', 'year']).toContain(range.period);
        expect(range.sample).toBeGreaterThanOrEqual(5);
        expect(range.medianHigh).toBeGreaterThanOrEqual(range.medianLow);
      }
      const keys = intro.salary.map((r) => `${r.currency}|${r.period}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('listingIntroBlock', () => {
  it('prints nothing for a list without an intro or without a role', () => {
    expect(listingIntroBlock(listingIntroFor('nowhere', 'nobody'), 'x')).toBe('');
    expect(listingIntroFor('moscow')).toBeUndefined();
  });

  it('prints the text, the date, the sample and one salary line per period', () => {
    const html = listingIntroBlock(
      {
        place: 'p',
        role: 'r',
        date: '2026-11-08',
        sample: 37,
        paragraphs: ['Текст <про> рынок.'],
        salary: [
          { currency: 'USD', period: 'year', sample: 8, medianLow: 150000, medianHigh: 180000 },
          { currency: 'USD', period: 'hour', sample: 5, medianLow: 40, medianHigh: 60 },
        ],
      },
      'Рынок',
    ).replace(/[\u00a0\u202f]/gu, ' ');
    expect(html).toContain('<p>Текст &lt;про&gt; рынок.</p>');
    expect(html).toContain('<b>150 000–180 000 $</b> в год · по 8 вакансиям');
    expect(html).toContain('<b>40–60 $</b> в час · по 5 вакансиям');
    expect(html).toContain('Срез 8 ноября 2026 года · вакансий в выборке: 37.');
  });

  it('maps hh RUR to ₽', () => {
    expect(
      salaryLine({
        currency: 'RUR',
        period: 'month',
        sample: 6,
        medianLow: 70000,
        medianHigh: 85000,
      }).replace(/[\u00a0\u202f]/gu, ' '),
    ).toContain('70 000–85 000 ₽</b> в месяц');
  });
});
