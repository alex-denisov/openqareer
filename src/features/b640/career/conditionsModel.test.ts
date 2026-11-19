import { describe, expect, it } from 'vitest';
import { EMPTY_SEARCH_CONDITIONS } from '../../career-map/careerConditionsStorage';
import { conditionRows, formatSalaryInput, parseSalary, SAVED_TEXT } from './conditionsModel';

describe('conditionRows', () => {
  it('пустые условия — «не указано» и действие «Указать»', () => {
    const rows = conditionRows(EMPTY_SEARCH_CONDITIONS);
    expect(rows.map((row) => [row.label, row.value, row.action])).toEqual([
      ['География', null, 'Указать'],
      ['Зарплата от', null, 'Указать'],
      ['Формат', null, 'Указать'],
      ['Стоп-лист', null, 'Указать'],
    ]);
  });

  it('заполненные условия как в макете', () => {
    const rows = conditionRows({
      geography: { selected: ['Москва', 'Удалённо из РФ'], isRelocationEnabled: false },
      salaryFrom: { amountRubles: 500_000, showWithoutSalary: true },
      format: { office: false, hybrid: true, remote: true },
      stopList: [
        { id: 'a', name: 'Ладога Банк', origin: '' },
        { id: 'b', name: 'Гринкод', origin: '' },
      ],
    });
    expect(rows.map((row) => row.value)).toEqual([
      'Москва, удалённо из РФ',
      '500 000 ₽ на руки',
      'гибрид, удалённо',
      'Ладога Банк, Гринкод',
    ]);
    expect(rows.every((row) => row.action === 'Изменить')).toBe(true);
  });
});

describe('parseSalary', () => {
  it('пробелы и пустое поле', () => {
    expect(parseSalary('500 000')).toEqual({ ok: true, value: 500_000 });
    expect(parseSalary('  ')).toEqual({ ok: true, value: null });
  });

  it('не число и слишком много — ошибка поля', () => {
    expect(parseSalary('пятьсот')).toEqual({ ok: false, error: 'Введите сумму цифрами' });
    expect(parseSalary('0')).toEqual({ ok: false, error: 'Введите сумму цифрами' });
    expect(parseSalary('1 000 000 000')).toEqual({
      ok: false,
      error: 'Слишком большая сумма',
    });
  });

  it('значение в поле с пробелами между разрядами', () => {
    expect(formatSalaryInput(500_000)).toBe('500 000');
    expect(formatSalaryInput(null)).toBe('');
  });
});

describe('SAVED_TEXT', () => {
  it('строка результата на месте правки', () => {
    expect(SAVED_TEXT).toBe('Сохранено · подборка обновится');
  });
});
