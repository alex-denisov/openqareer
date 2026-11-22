import { describe, expect, it } from 'vitest';
import {
  addBlock,
  blockCountTitle,
  liveCriteria,
  minutesLabel,
  minutesLeft,
  moveBlock,
  practiceChoice,
  removeBlock,
  renameBlock,
  reviewRows,
  reviewTitle,
  schemaBlocks,
  schemaToSave,
  taskPoints,
} from './practiceModel';

const ANSWER =
  'Требования: 2 000 платежей в секунду, пики нагрузки. Приложение шлёт запрос в шлюз API, ' +
  'шлюз кладёт платёж в очередь, сервис платежей пишет в базу PostgreSQL.';

describe('minutesLabel: согласование «минута / минуты / минут»', () => {
  it('склоняет по числу', () => {
    expect([1, 2, 4, 5, 11, 21, 33, 45].map(minutesLabel)).toEqual([
      '1 минута',
      '2 минуты',
      '4 минуты',
      '5 минут',
      '11 минут',
      '21 минута',
      '33 минуты',
      '45 минут',
    ]);
  });
});

describe('I3a: задача и выбор тренировки', () => {
  it('пункты задачи — предложения условия, без пустых', () => {
    expect(
      taskPoints(
        'Спроектируйте приём платежей: повторы. Используйте стек: Go. Начните с требований.',
      ),
    ).toEqual([
      'Спроектируйте приём платежей: повторы.',
      'Используйте стек: Go.',
      'Начните с требований.',
    ]);
  });

  it('тренировка этого отклика по System Design продолжается; другая — сначала закончить', () => {
    const own = {
      status: 'active',
      applicationId: 'r1',
      questionTypes: ['system_design'],
      questions: [{}],
    };
    expect(practiceChoice(null, 'r1')).toBe('start');
    expect(practiceChoice(own, 'r1')).toBe('resume');
    expect(practiceChoice({ ...own, status: 'completed' }, 'r1')).toBe('start');
    const answered = { ...own, status: 'completed', questions: [{ answer: { text: 'x' } }] };
    expect(practiceChoice(answered, 'r1')).toBe('review');
    expect(practiceChoice({ ...answered, applicationId: 'r2' }, 'r1')).toBe('start');
    expect(practiceChoice({ ...own, questionTypes: ['behavioral'] }, 'r1')).toBe('other');
    expect(practiceChoice({ ...own, applicationId: 'r2' }, 'r1')).toBe('other');
  });
});

describe('I3b: ответ', () => {
  it('таймер от начала тренировки: целые минуты, не меньше нуля', () => {
    const start = '2026-11-22T10:00:00.000Z';
    expect(minutesLeft(start, 45, Date.parse('2026-11-22T10:00:00.000Z'))).toBe(45);
    expect(minutesLeft(start, 45, Date.parse('2026-11-22T10:07:30.000Z'))).toBe(38);
    expect(minutesLeft(start, 45, Date.parse('2026-11-22T11:00:00.000Z'))).toBe(0);
    // Часы сервера впереди часов браузера: больше лимита не показываем.
    expect(minutesLeft(start, 45, Date.parse('2026-11-22T09:59:30.000Z'))).toBe(45);
  });

  it('критерии по мере ответа: прозвучало — с цитатой, нет — «Пока не звучало»', () => {
    const rows = liveCriteria(ANSWER);
    expect(rows.map((row) => row.title)).toEqual([
      'Требования',
      'Архитектура',
      'Компромиссы',
      'Эксплуатация',
    ]);
    expect(rows[0]).toMatchObject({ tag: 'прозвучало', ok: true });
    expect(rows[0]!.sub).toContain('2 000');
    expect(rows[2]).toMatchObject({ tag: 'не звучало', ok: false, sub: 'Пока не звучало' });
    expect(liveCriteria('').every((row) => row.tag === 'не звучало')).toBe(true);
  });

  it('схема по ответу: блоки по порядку; правки кандидата поверх неё', () => {
    const blocks = schemaBlocks(ANSWER, []);
    const labels = blocks.map((block) => block.label);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    const [first, second] = blocks;
    const edits = [
      renameBlock(first!.id, 'Мобильное приложение'),
      moveBlock(second!.id, -1),
      addBlock('Кэш ключей повтора'),
    ];
    const edited = schemaBlocks(ANSWER, edits);
    expect(edited[0]!.id).toBe(second!.id);
    expect(edited[1]).toMatchObject({ id: first!.id, label: 'Мобильное приложение' });
    expect(edited.at(-1)!.label).toBe('Кэш ключей повтора');
    const removed = schemaBlocks(ANSWER, [...edits, removeBlock(first!.id)]);
    expect(removed.some((block) => block.id === first!.id)).toBe(false);
  });

  it('сохраняется схема целиком: узлы по порядку, связи между оставшимися', () => {
    const blocks = schemaBlocks(ANSWER, [addBlock('Кэш ключей повтора')]);
    const saved = schemaToSave(ANSWER, blocks);
    expect(saved.nodes.map((node) => node.label)).toEqual(blocks.map((block) => block.label));
    const ids = new Set(saved.nodes.map((node) => node.id));
    expect(saved.links.every((link) => ids.has(link.from) && ids.has(link.to))).toBe(true);
    expect(saved.nodes.every((node) => /^[a-z0-9_-]{1,40}$/u.test(node.id))).toBe(true);
  });
});

describe('I3c: разбор', () => {
  const evaluation = {
    rubric: 'system_design' as const,
    points: 5,
    maxPoints: 8,
    criteria: {
      requirements: {
        points: 2 as const,
        reason: 'Требования уточнены.',
        quote: '2 000 в секунду',
      },
      architecture: {
        points: 2 as const,
        reason: 'Компоненты описаны.',
        quote: 'шлюз API, очередь',
      },
      tradeoffs: { points: 0 as const, reason: 'Не объяснён выбор.' },
      operations: { points: 1 as const, reason: 'Добавьте метрики.', quote: 'следим за очередью' },
    },
  };

  it('строки разбора: вердикт, цитата из ответа и тег по баллам', () => {
    const rows = reviewRows(evaluation);
    expect(rows[0]).toMatchObject({
      title: 'Требования',
      sub: 'Требования уточнены.',
      quote: 'Из ответа: «2 000 в секунду»',
      tag: 'прозвучало',
      ok: true,
    });
    expect(rows[2]).toMatchObject({ tag: 'не хватило', ok: false, quote: null });
    expect(rows[3]).toMatchObject({ tag: 'частично', ok: false });
  });

  it('заголовок: сколько закрыто и сколько не полностью', () => {
    expect(reviewTitle(evaluation)).toBe('Четыре критерия: два закрыты, два — не полностью');
    const all = {
      ...evaluation,
      criteria: Object.fromEntries(
        Object.entries(evaluation.criteria).map(([key, value]) => [
          key,
          { ...value, points: 2 as const },
        ]),
      ),
    };
    expect(reviewTitle(all)).toBe('Четыре критерия: все закрыты');
    const one = {
      ...evaluation,
      criteria: { ...evaluation.criteria, architecture: { points: 1 as const, reason: 'x' } },
    };
    expect(reviewTitle(one)).toBe('Четыре критерия: один закрыт, три — не полностью');
  });
});

describe('I3c: заголовок схемы', () => {
  it('число блоков словом, дальше цифрой с верным окончанием', () => {
    expect(blockCountTitle(1)).toBe('Один блок');
    expect(blockCountTitle(3)).toBe('Три блока');
    expect(blockCountTitle(5)).toBe('Пять блоков');
    expect(blockCountTitle(21)).toBe('21 блок');
    expect(blockCountTitle(12)).toBe('12 блоков');
  });
});
