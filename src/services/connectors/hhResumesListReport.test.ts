import { describe, expect, it } from 'vitest';
import { hhResumesListReport } from './hhResumesListReport';

const card = (id: string, title: string, visibility: string) =>
  `<div data-qa="resume"><a href="/resume/${id}"><span>${title}</span></a><div>${visibility}</div></div>`;

describe('список резюме hh.ru для диагностики (B787)', () => {
  it('число резюме, id, название и видимость по каждому', () => {
    const html = `<main>${card('aaa111', 'IT Директор / CIO / CTO', 'Видно всем работодателям.')}${card(
      'bbb222',
      'IT Директор / CIO / CTO',
      'Не видно никому',
    )}</main>`;
    const report = hhResumesListReport(html, new Date('2026-11-26T04:00:00Z'));
    const lines = report.split('\n');
    expect(lines[1]).toBe('resumes 2');
    expect(lines[3]).toMatch(/^aaa111\tIT Директор \/ CIO \/ CTO\tВидно всем работодателям\t/u);
    expect(lines[4]).toMatch(/^bbb222\tIT Директор \/ CIO \/ CTO\tНе видно никому\t/u);
  });

  it('без признака видимости — прочерк; пустой список — ноль', () => {
    expect(hhResumesListReport(`<main>${card('ccc333', 'CTO', '')}</main>`)).toMatch(
      /ccc333\tCTO\t-\t/u,
    );
    expect(hhResumesListReport('<main></main>')).toContain('resumes 0');
  });
});
