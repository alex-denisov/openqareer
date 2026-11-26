import { describe, expect, it } from 'vitest';
import {
  HH_MARKUP_SKETCH_MAX_LENGTH,
  hhResumeMarkupSketch,
  maskResumeText,
} from './hhResumeMarkupSketch';

const card = `<div data-qa="profile-experience-company-card"><div data-qa="cell-left-side">
  <span>Россети Цифра</span><span>4&nbsp;года</span></div><ol data-qa="magritte-stepper">
  <li data-qa="magritte-stepper-step"><div><span>Директор</span><span>Апрель 2023 — по настоящее время</span>
  <p>Выручка 920 млн</p></div></li></ol></div>`;

describe('набросок разметки резюме hh.ru для диагностики (B787)', () => {
  it('буквы — x, месяцы — токены, цифры и тире как есть', () => {
    expect(maskResumeText('Апрель 2023 — Oct. 2025 Россети')).toBe(
      'MON_04 2023 ? MON_10. 2025 xxxxxxx',
    );
    expect(maskResumeText('янв. 2020 - Jan 2021')).toBe('MON_01. 2020 - MON_01 2021');
  });

  it('держит теги и data-qa, без личного текста и только ASCII', () => {
    const sketch = hhResumeMarkupSketch(`<main>${card}${card}${card}</main>`);
    expect(sketch).toContain('cards 3');
    expect(sketch).toContain('div[profile-experience-company-card]');
    expect(sketch).toContain('li[magritte-stepper-step]');
    expect(sketch).toContain('"MON_04 2023 ? xx xxxxxxxxx xxxxx"');
    expect(sketch).toContain('"xxxxxxx 920 xxx"');
    expect(sketch).not.toMatch(/Россети|Директор|Выручка/u);
    expect(sketch).toMatch(/^[\n\x20-\x7e]*$/u);
    expect(sketch.split('div[profile-experience-company-card]').length - 1).toBe(2);
  });

  it('без карточек берёт блок опыта, иначе пусто; длина ограничена', () => {
    expect(
      hhResumeMarkupSketch(
        '<main><div data-qa="resume-list-card-experience"><p>Опыт</p></div></main>',
      ),
    ).toContain('div[resume-list-card-experience]');
    expect(hhResumeMarkupSketch('<main></main>')).toContain('cards 0');
    const long = `<main>${card.replace('Выручка 920 млн', 'x '.repeat(50_000))}</main>`;
    expect(hhResumeMarkupSketch(long).length).toBeLessThanOrEqual(HH_MARKUP_SKETCH_MAX_LENGTH);
  });
});
