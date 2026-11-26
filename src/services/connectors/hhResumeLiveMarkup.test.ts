import { describe, expect, it } from 'vitest';
import { parseHhResumeHtml } from './hhResumeParser';
import { hhResumeMarkupSketch } from './hhResumeMarkupSketch';

/**
 * B787: форма живой страницы из hh-resume-markup.txt (.app 1.1.289, 26.11): глубокая вложенность
 * cell-text, React-комментарии внутри срока и стажа. Значения — вымышленные.
 */
const text = (value: string) =>
  `<div data-qa="cell-text"><div><div><div><div><div><div><span data-qa="cell-text-content">${value}</span></div></div></div></div></div></div></div>`;
const card = (employer: string, title: string, period: string) => `
  <div data-qa="profile-experience-company-card"><div><div>
    <div data-qa="cell"><div data-qa="cell-left-side"><div><span></span><img></div>
      <div>${text(employer)}${text('<span>2<!-- --> <!-- -->года</span> и <span>7<!-- --> <!-- -->месяцев</span>')}</div>
    </div></div>
    <div></div>
    <ol data-qa="magritte-stepper"><li data-qa="magritte-stepper-step">
      <div><div></div><svg><path d="M0"></path></svg></div>
      <div data-qa="magritte-stepper-step-content"><div>
        <div data-qa="cell"><div data-qa="cell-left-side"><div>${text(title)}</div>${text(period)}</div><div></div></div>
        <div><span><span>Отвечал за поддержку.<br>Выручка 920 млн</span></span></div>
      </div></div>
    </li></ol>
  </div></div></div>`;
const page = `<main><div data-qa="resume-list-card-experience">${card(
  'ПАО «Компания»',
  'CIO (руководство ИТ)',
  'Апрель<!-- --> <!-- -->2023<!-- --> — <!-- -->Октябрь<!-- --> <!-- -->2025',
)}${card('Банк', 'CTO', 'Март<!-- --> <!-- -->2020<!-- --> — <!-- -->по настоящее время')}</div></main>`;

describe('живая разметка карточек опыта hh.ru (B787, 1.1.289)', () => {
  it('читает места сквозь React-комментарии', () => {
    const parsed = parseHhResumeHtml(page, 'https://hh.ru/resume/a');
    expect(
      parsed.experience.map((p) => [
        p.employer,
        p.title,
        p.startDate,
        p.endDate,
        p.current,
        p.responsibilities,
      ]),
    ).toEqual([
      [
        'ПАО «Компания»',
        'CIO (руководство ИТ)',
        'Апрель 2023',
        'Октябрь 2025',
        false,
        ['Отвечал за поддержку.\nВыручка 920 млн'],
      ],
      ['Банк', 'CTO', 'Март 2020', undefined, true, ['Отвечал за поддержку.\nВыручка 920 млн']],
    ]);
  });

  it('набросок без комментариев, глубина после svg не съезжает', () => {
    const sketch = hhResumeMarkupSketch(page);
    expect(sketch).not.toContain('<!--');
    expect(sketch).toContain('"MON_04 2023 ? MON_10 2025"');
    const indent = (marker: string) =>
      /^( *)/u.exec(sketch.split('\n').find((line) => line.trim() === marker) ?? '')?.[1]?.length;
    expect(indent('div[magritte-stepper-step-content]')).toBeGreaterThan(
      indent('li[magritte-stepper-step]') ?? 0,
    );
  });
});
