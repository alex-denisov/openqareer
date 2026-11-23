import { describe, expect, it } from 'vitest';
import { groundBaseline, parseGoalExamples, type BaselineEntry } from './goalHints';

describe('B744: примеры целей под роль (d02c)', () => {
  it('три примера без цифр и повторов', () => {
    expect(
      parseGoalExamples({
        examples: [
          { title: 'Снизить  отток клиентов', measure: 'доля ушедших за квартал' },
          { title: 'Снизить отток клиентов', measure: 'повтор' },
          { title: 'Выйти на 15 новых клиентов', measure: 'число сделок' },
          { title: 'Собрать воронку продаж', measure: 'сделок на этапе' },
          { title: 'Выполнить план выручки', measure: 'от плана квартала' },
          { title: 'Четвёртая', measure: 'лишняя' },
        ],
      }),
    ).toEqual([
      { title: 'Снизить отток клиентов', measure: 'доля ушедших за квартал' },
      { title: 'Собрать воронку продаж', measure: 'сделок на этапе' },
      { title: 'Выполнить план выручки', measure: 'от плана квартала' },
    ]);
  });

  it('меньше трёх годных или не та форма — примеров нет', () => {
    expect(
      parseGoalExamples({ examples: [{ title: 'Одна цель', measure: 'одна мера' }] }),
    ).toBeNull();
    expect(parseGoalExamples({ items: [] })).toBeNull();
    expect(parseGoalExamples(null)).toBeNull();
  });
});

const entries: BaselineEntry[] = [
  { id: 'e1', date: '2026-12-30', text: 'Команда жалуется: ревью ждут по полтора-два дня.' },
  { id: 'e2', date: '2027-01-05', text: 'Встреча с CTO про найм.' },
];

describe('B744: значение «Сейчас» из записей (d02b)', () => {
  it('цитата дословно в названной записи — значение с датой записи', () => {
    expect(
      groundBaseline(
        { value: 18, entryId: 'e1', quote: '«ревью ждут по полтора-два дня»' },
        entries,
      ),
    ).toEqual({ value: 18, quote: 'ревью ждут по полтора-два дня', entryDate: '2026-12-30' });
  });

  it('пересказ, чужая запись или выдуманный id — значения нет', () => {
    expect(
      groundBaseline({ value: 18, entryId: 'e1', quote: 'ревью идёт два дня' }, entries),
    ).toBeNull();
    expect(
      groundBaseline({ value: 18, entryId: 'e2', quote: 'ревью ждут по полтора-два дня' }, entries),
    ).toBeNull();
    expect(
      groundBaseline({ value: 18, entryId: 'x', quote: 'ревью ждут по полтора-два дня' }, entries),
    ).toBeNull();
  });

  it('модель не нашла значения или ответила не по схеме — значения нет', () => {
    expect(groundBaseline({ value: null, entryId: null, quote: null }, entries)).toBeNull();
    expect(groundBaseline({ value: '18', entryId: 'e1', quote: 'ревью' }, entries)).toBeNull();
    expect(
      groundBaseline({ value: 18, entryId: 'e1', quote: 'x'.repeat(201) }, entries),
    ).toBeNull();
  });
});
