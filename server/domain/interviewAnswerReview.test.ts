import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswer } from './interviewSimulator';
import {
  checkAnswerNumbers,
  quoteFor,
  scoreInterviewAnswerWithQuotes,
} from './interviewAnswerReview';

const fact = (id: string, statement: string, status = 'confirmed') => ({
  id,
  kind: 'fact',
  status,
  statement,
  sourceMessageIds: ['m1'],
  sensitive: false,
});

describe('quoteFor', () => {
  it('returns the original sentence with the first matched cue', () => {
    const answer =
      'Начну с требований. Мы ВЫБРАЛИ Kafka, потому что нужен replay! Дальше мониторинг.';
    expect(quoteFor(answer, ['выбрал'])).toBe('Мы ВЫБРАЛИ Kafka, потому что нужен replay!');
  });

  it('returns null when no cue matches', () => {
    expect(quoteFor('Просто текст.', ['кэш'])).toBeNull();
  });

  it('caps a long sentence at 200 chars', () => {
    const quote = quoteFor(`Кэш ${'а'.repeat(300)}`, ['кэш']);
    expect(quote?.length).toBeLessThanOrEqual(200);
  });
});

describe('scoreInterviewAnswerWithQuotes', () => {
  const answer =
    'Сначала требования: 10 тысяч RPS и latency до 100 мс. Компоненты: API, очередь и кэш. ' +
    'Я выбрал очередь, потому что важна повторная доставка. Метрики и алерты на ошибки.';

  it('keeps points equal to the old evaluation and adds a quote to every scored criterion', () => {
    const plain = scoreInterviewAnswer(answer, 'system_design');
    const quoted = scoreInterviewAnswerWithQuotes(answer, 'system_design');
    expect(quoted.points).toBe(plain.points);
    for (const [name, criterion] of Object.entries(quoted.criteria)) {
      expect(criterion.points).toBe(plain.criteria[name].points);
      expect(criterion.reason).toBe(plain.criteria[name].reason);
      if (criterion.points > 0) expect(answer).toContain(criterion.quote);
    }
    expect(quoted.criteria.tradeoffs.quote).toBe(
      'Я выбрал очередь, потому что важна повторная доставка.',
    );
  });

  it('gives no quote to a criterion with zero points', () => {
    const quoted = scoreInterviewAnswerWithQuotes('Сделаю сервис.', 'system_design');
    expect(quoted.criteria.tradeoffs.points).toBe(0);
    expect(quoted.criteria.tradeoffs).not.toHaveProperty('quote');
  });

  it('quotes the numeric result of a STAR answer', () => {
    const star =
      'В команде релизы шли долго. Цель — ускорить. Я настроил CI. Цикл стал 3 дня вместо 14.';
    const quoted = scoreInterviewAnswerWithQuotes(star, 'behavioral');
    expect(quoted.criteria.result.points).toBe(2);
    expect(quoted.criteria.result.quote).toBe('Цикл стал 3 дня вместо 14.');
  });

  it('does not change the old evaluation object', () => {
    expect(JSON.stringify(scoreInterviewAnswer(answer, 'system_design'))).not.toContain('quote');
  });
});

describe('checkAnswerNumbers', () => {
  it('links numbers to confirmed facts only', () => {
    const result = checkAnswerNumbers(
      'Сократил цикл с 14 до 3 дней, команда 12 человек, рост 2,5 раза.',
      [
        fact('f1', 'Цикл релиза сократился с 14 до 3 дней.'),
        fact('f2', 'Руководил командой из 12 человек.', 'proposed'),
        fact('f3', 'Выручка выросла в 2.5 раза.'),
      ],
    );
    expect(result).toEqual([
      {
        value: '14',
        matchedFactId: 'f1',
        matchedFactStatement: 'Цикл релиза сократился с 14 до 3 дней.',
      },
      {
        value: '3',
        matchedFactId: 'f1',
        matchedFactStatement: 'Цикл релиза сократился с 14 до 3 дней.',
      },
      { value: '12', matchedFactId: null, matchedFactStatement: null },
      { value: '2,5', matchedFactId: 'f3', matchedFactStatement: 'Выручка выросла в 2.5 раза.' },
    ]);
  });

  it('does not match a number inside a longer one and lists each number once', () => {
    expect(checkAnswerNumbers('Было 4, стало 4.', [fact('f1', 'Офис на 400 мест.')])).toEqual([
      { value: '4', matchedFactId: null, matchedFactStatement: null },
    ]);
  });
});
