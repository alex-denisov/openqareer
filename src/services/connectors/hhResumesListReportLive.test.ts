import { describe, expect, it } from 'vitest';
import { hhResumesListReport } from './hhResumesListReport';

const card = `<div data-qa="resume"><a data-qa="resume-card-link-x" href="/resume/abc123?from=profile"><div data-qa="title-header">CIO</div><div data-qa="title-description title-description_changeVisibility"><span>Скрыто от всех кроме меня</span></div></a></div>`;

describe('B787: visibility on the 1.1.293 profile card', () => {
  it('takes the visibility line from the card description when the link carries a query', () => {
    const report = hhResumesListReport(`<main>${card}</main>`);
    expect(report).toMatch(/Скрыто от всех кроме меня/u);
  });
});

describe('B787: видимость в списке 1.1.297', () => {
  it('доход и формат работы видимого резюме не выдаются за видимость', () => {
    const visible = `<div data-qa="resume"><a data-qa="resume-card-link-cio8031" href="/resume/cio8031?from=profile"><div data-qa="title-header">Резюме</div><div data-qa="resume-title"><span data-qa="cell-text-content">IT Директор / CIO / CTO</span></div><div data-qa="title-description"><span data-qa="cell-text-content">Уровень дохода не указан · Гибрид, Удалённо</span></div></a></div>`;
    const row = hhResumesListReport(`<main>${visible}${card}</main>`)
      .split('\n')
      .find((line) => line.startsWith('cio8031'));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/дохода|Гибрид/u);
    expect(row!.split('\t')[2]).toBe('-');
  });
});
