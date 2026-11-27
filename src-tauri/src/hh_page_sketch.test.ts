import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const file = readFileSync(join(__dirname, 'hh_page_sketch.js'), 'utf8');
const SRC = '8031e902ff0763b56f0039ed1f633855625937';
const OTHER = '6369c686ff116c27a80039ed1f667141595754';

function sketch(html: string, source?: string): string {
  const dom = new JSDOM(`<body><main>${html}</main></body>`, {
    url: 'https://hh.ru/applicant/profile/me',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  if (source) (window as unknown as { __oqCopy: unknown }).__oqCopy = { source };
  return String(window.eval(file));
}

const card = (id: string, title: string) =>
  `<div data-qa="resume"><div><div><a data-qa="resume-card-link-${id}" href="/resume/${id}?from=profile"><div><div data-qa="resume-title"><span>${title}</span></div></div></a></div><div><button data-qa="resume-list-action-more"></button></div></div></div>`;
// B787, дамп 1.1.297: перед списком — длинный блок советов; карточка источника — в свёрнутой части.
const advice = '<div>'.repeat(40) + 'совет '.repeat(200) + '</div>'.repeat(40);
const page = `${advice}<div data-qa="compact-resume-list">${card(OTHER, 'Операционный директор')}<div hidden>${card(SRC, 'IT Директор')}</div></div>`;

describe('B787: набросок списка резюме', () => {
  it('начинается с карточки источника, помечает скрытое и маскирует id в href и текст', () => {
    const out = sketch(page, SRC);
    expect(out).toMatch(/source_card 1 of 2/u);
    expect(out).toMatch(/menu_buttons_shown 1/u);
    const sourceAt = out.indexOf('--- markup');
    const firstCard = out.slice(sourceAt).split('--- list')[0];
    expect(firstCard).toMatch(/div\[resume\] shown=0/u);
    expect(firstCard).toMatch(/href=\/resume\/ID/u);
    expect(out).not.toMatch(/IT Директор|Операционный/u);
    expect(out).not.toContain(`/resume/${SRC}`);
    expect(out).not.toMatch(/xxxxx xxxxx xxxxx xxxxx/u);
    expect(out.length).toBeLessThanOrEqual(16_000);
    expect(/^[\x20-\x7e\n]*$/u.test(out)).toBe(true);
  });

  it('без списка резюме обходит main как раньше', () => {
    expect(sketch('<div data-qa="vacancy-title">Вакансия</div>')).toMatch(/div\[vacancy-title\]/u);
  });
});
