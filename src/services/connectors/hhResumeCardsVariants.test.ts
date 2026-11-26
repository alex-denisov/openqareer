import { describe, expect, it } from 'vitest';
import { parseHhResumeHtml } from './hhResumeParser';

/** B787: варианты разметки карточек опыта, на которых чтение давало ноль мест. */
const page = (cards: string) =>
  `<main><div data-qa="resume-list-card-experience">${cards}</div></main>`;
const step = (inner: string) =>
  `<li data-qa="magritte-stepper-step"><div data-qa="magritte-stepper-step-content">${inner}</div></li>`;
const places = (html: string) =>
  parseHhResumeHtml(page(html), 'https://hh.ru/resume/a').experience.map((p) => [
    p.employer,
    p.title,
    p.startDate,
    p.endDate,
    p.current,
  ]);

describe('карточки опыта hh.ru: устойчивость разбора (B787)', () => {
  it('одна ступень, должность в шапке карточки', () => {
    const card = `<div data-qa="profile-experience-company-card"><div data-qa="cell-left-side">
      <div>Компания</div><div>Директор по ИТ</div><div>4 года</div></div>
      <ol data-qa="magritte-stepper">${step('<span>Апрель 2021 — по настоящее время</span><p>Текст</p>')}</ol></div>`;
    expect(places(card)).toEqual([['Компания', 'Директор по ИТ', 'Апрель 2021', undefined, true]]);
  });

  it('имя компании без cell-left-side — первая строка шапки; цифры в имени сохраняются', () => {
    const card = `<div data-qa="profile-experience-company-card"><div data-qa="company-header">
      <div>X5 Group</div><div>2 года</div></div>
      <ol data-qa="magritte-stepper">${step('<span>Руководитель</span><span>Май 2019 — Июнь 2021</span>')}</ol></div>`;
    expect(places(card)).toEqual([['X5 Group', 'Руководитель', 'Май 2019', 'Июнь 2021', false]]);
  });

  it('сроки сокращёнными месяцами и только годами', () => {
    const card = `<div data-qa="profile-experience-company-card"><div data-qa="cell-left-side"><span>Банк</span></div>
      <ol data-qa="magritte-stepper">${step('<span>CTO</span><span>янв. 2020 — дек. 2022</span>')}${step(
        '<span>Архитектор</span><span>2015 — 2019</span>',
      )}</ol></div>`;
    expect(places(card)).toEqual([
      ['Банк', 'CTO', 'янв. 2020', 'дек. 2022', false],
      ['Банк', 'Архитектор', '2015', '2019', false],
    ]);
  });

  it('несколько ступеней без должности перед сроком — шапка должностью не становится', () => {
    const card = `<div data-qa="profile-experience-company-card"><div data-qa="cell-left-side"><span>Банк</span><span>CIO</span></div>
      <ol data-qa="magritte-stepper">${step('<span>2015 — 2019</span>')}${step('<span>2019 — 2020</span>')}</ol></div>`;
    expect(places(card)).toEqual([]);
  });

  it('месяц внутри слова должности месяцем не считается', () => {
    const card = `<div data-qa="profile-experience-company-card"><div data-qa="cell-left-side"><span>Банк</span></div>
      <ol data-qa="magritte-stepper">${step('<div>Смарт 2015 лид</div><div>2016 — 2019</div>')}</ol></div>`;
    expect(places(card)).toEqual([['Банк', 'Смарт 2015 лид', '2016', '2019', false]]);
  });
});
