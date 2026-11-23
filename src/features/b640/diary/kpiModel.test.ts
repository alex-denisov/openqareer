import { describe, expect, it } from 'vitest';
import type { CareerDiaryKpiImport, CareerDiaryKpiRow } from '../../../../shared/careerDiaryKpi';
import {
  acceptRows,
  draftRows,
  horizonEnd,
  rowSummary,
  sourceLine,
  splitTarget,
  weightLine,
  weightNote,
} from './kpiModel';

const row = (patch: Partial<CareerDiaryKpiRow>): CareerDiaryKpiRow => ({
  id: 'r1',
  title: 'Срок релиза',
  target: '7 дней',
  targetValue: 7,
  unit: 'дней',
  dueDate: null,
  horizon: 'quarter',
  weight: 50,
  setBy: 'manager',
  quote: '',
  ...patch,
});

const draft = (rows: CareerDiaryKpiRow[]): CareerDiaryKpiImport => ({
  id: 'i1',
  sourceKind: 'text',
  sourceName: null,
  createdAt: '2027-01-03T10:00:00.000Z',
  rows,
  weightSum: 100,
  acceptedGoalIds: [],
  sourceStored: true,
});

describe('kpiModel', () => {
  it('splitTarget: число и единица, иначе цель словами', () => {
    expect(splitTarget('7 дней')).toEqual({ targetValue: 7, unit: 'дней' });
    expect(splitTarget('95 %')).toEqual({ targetValue: 95, unit: '%' });
    expect(splitTarget('1,5')).toEqual({ targetValue: 1.5, unit: '' });
    expect(splitTarget('не больше 2 в месяц')).toEqual({
      targetValue: 'не больше 2 в месяц',
      unit: '',
    });
  });

  it('horizonEnd: конец квартала, следующего квартала и года', () => {
    expect(horizonEnd('quarter', '2027-01-03')).toBe('2027-03-31');
    expect(horizonEnd('next_quarter', '2027-11-20')).toBe('2028-03-31');
    expect(horizonEnd('year', '2027-01-03')).toBe('2027-12-31');
  });

  it('пустое из разбора остаётся пустым, все строки отмечены «Верно»', () => {
    const [first] = draftRows(
      draft([row({ horizon: null, setBy: null, weight: null, target: '', targetValue: null })]),
    );
    expect(first).toMatchObject({ horizon: '', setBy: '', weight: '', target: '', ok: true });
  });

  it('принятие: срок из горизонта, вес числом; ошибки на месте строки', () => {
    const rows = draftRows(
      draft([
        row({}),
        row({ id: 'r2', title: 'Закрыто вакансий', target: '2 шт.', dueDate: '2027-02-28' }),
      ]),
    );
    const result = acceptRows(rows, '2027-01-03');
    expect(result).toEqual({
      rows: [
        {
          title: 'Срок релиза',
          unit: 'дней',
          targetValue: 7,
          dueDate: '2027-03-31',
          horizon: 'quarter',
          weight: 50,
          setBy: 'manager',
          quarterTargets: null,
        },
        {
          title: 'Закрыто вакансий',
          unit: 'шт.',
          targetValue: 2,
          dueDate: '2027-02-28',
          horizon: 'quarter',
          weight: 50,
          setBy: 'manager',
          quarterTargets: null,
        },
      ],
    });
    const broken = acceptRows(
      [
        { ...rows[0]!, horizon: '', target: '' },
        { ...rows[1]!, ok: false },
      ],
      '2027-01-03',
    );
    expect(broken).toEqual({ errors: { r1: 'Укажите цель и срок' } });
  });

  it('B686: строка без «кто ставит» называет именно это поле, а не цель и срок', () => {
    const rows = draftRows(draft([row({}), row({ id: 'r2' })]));
    const result = acceptRows(
      [
        { ...rows[0]!, setBy: '' },
        { ...rows[1]!, horizon: '' },
      ],
      '2027-01-03',
    );
    expect(result).toEqual({ errors: { r1: 'Укажите, кто ставит цель', r2: 'Укажите срок' } });
  });

  it('вес не на 100 % — ошибка суммы; без отмеченных строк — нечего принимать', () => {
    const rows = draftRows(draft([row({ weight: 30 }), row({ id: 'r2', weight: 30 })]));
    expect(acceptRows(rows, '2027-01-03')).toEqual({ sum: 'Вес в сумме — 60 %, нужно 100 %' });
    expect(weightLine(rows)).toBe('Вес в сумме — 60 %');
    expect(
      acceptRows(
        rows.map((item) => ({ ...item, ok: false })),
        '2027-01-03',
      ),
    ).toEqual({ errors: {} });
  });

  it('строка источника для ⓘ', () => {
    expect(sourceLine(draft([row({})]))).toBe('Из текста, загружено 3 января.');
    expect(sourceLine({ ...draft([row({})]), sourceKind: 'photo', sourceName: 'slide.png' })).toBe(
      'Из фото slide.png, загружено 3 января.',
    );
  });
});

describe('d02l на 390: строка списка и ⓘ веса', () => {
  it('подпись строки: срок, вес, кто поставил — без пустых частей', () => {
    const [first] = draftRows(draft([row({})]));
    expect(rowSummary(first!)).toBe('квартал · вес 50 % · руководитель');
    expect(rowSummary({ ...first!, horizon: '', weight: '', setBy: '' })).toBe('');
  });

  it('ⓘ «Как считается вес»: замеры в карточке и сумма отмеченных', () => {
    const rows = draftRows(draft([row({}), row({ id: 'r2' })]));
    expect(weightNote(rows)).toBe('Замеры вносятся в карточке цели; вес в сумме — 100 %.');
    expect(weightNote(rows.map((item) => ({ ...item, weight: '' })))).toBe(
      'Замеры вносятся в карточке цели.',
    );
  });
});

describe('B742: вклад кварталов из черновика в цель', () => {
  it('годовая строка передаёт кварталы; сменили срок на квартал — кварталов нет', () => {
    const quarterTargets = [{ quarter: 1 as const, value: 85 }];
    const [first] = draftRows(draft([row({ horizon: 'year', weight: 100, quarterTargets })]));
    expect(first?.quarterTargets).toEqual(quarterTargets);
    const yearRows = acceptRows([first!], '2027-01-03');
    expect('rows' in yearRows && yearRows.rows[0]?.quarterTargets).toEqual(quarterTargets);
    const quarterRows = acceptRows([{ ...first!, horizon: 'quarter' }], '2027-01-03');
    expect('rows' in quarterRows && quarterRows.rows[0]?.quarterTargets).toBeNull();
  });
});
