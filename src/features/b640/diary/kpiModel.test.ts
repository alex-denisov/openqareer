import { describe, expect, it } from 'vitest';
import type { CareerDiaryKpiImport, CareerDiaryKpiRow } from '../../../../shared/careerDiaryKpi';
import { acceptRows, draftRows, horizonEnd, sourceLine, splitTarget, weightLine } from './kpiModel';

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
        },
        {
          title: 'Закрыто вакансий',
          unit: 'шт.',
          targetValue: 2,
          dueDate: '2027-02-28',
          horizon: 'quarter',
          weight: 50,
          setBy: 'manager',
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
