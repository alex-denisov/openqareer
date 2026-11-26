import { describe, expect, it } from 'vitest';
import { hhResumesListReport } from './hhResumesListReport';

const card = `<div data-qa="resume"><a data-qa="resume-card-link-x" href="/resume/abc123?from=profile"><div data-qa="title-header">CIO</div><div data-qa="title-description title-description_changeVisibility"><span>Скрыто от всех кроме меня</span></div></a></div>`;

describe('B787: visibility on the 1.1.293 profile card', () => {
  it('takes the visibility line from the card description when the link carries a query', () => {
    const report = hhResumesListReport(`<main>${card}</main>`);
    expect(report).toMatch(/Скрыто от всех кроме меня/u);
  });
});
