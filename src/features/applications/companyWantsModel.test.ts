import { describe, expect, it, vi } from 'vitest';

vi.mock('../resume/resumeExport', () => ({ triggerFileDownload: vi.fn() }));

import { companyWantsCsv, exceedsBulkLimit, parseCompanyNames } from './companyWantsModel';

describe('companyWantsModel', () => {
  it('reads names from pasted lines and the first CSV column without duplicates', () => {
    expect(parseCompanyNames('Альфа\n"Бета";Финтех\n\nальфа\r\nГамма,1')).toEqual([
      'Альфа',
      'Бета',
      'Гамма',
    ]);
  });

  it('limits one batch to 500 companies', () => {
    expect(exceedsBulkLimit(500)).toBe(false);
    expect(exceedsBulkLimit(501)).toBe(true);
  });

  it('exports CSV with escaped cells and neutralised formulas', () => {
    const csv = companyWantsCsv([
      {
        key: 'a',
        name: '=HYPERLINK',
        industry: 'Банки; РФ',
        stage: 'path',
        vacancyCount: 2,
        contactsCount: null,
        nextStep: 'Написать "Игорю"',
      },
    ]);
    expect(csv).toContain('\'=HYPERLINK;"Банки; РФ";Ищу путь;2;;"Написать ""Игорю"""');
  });
});
