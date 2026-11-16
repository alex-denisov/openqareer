import { describe, expect, it } from 'vitest';
import { publishedLine, textBlocks } from './textBlocks';

describe('textBlocks', () => {
  it('строка с двоеточием на конце — подзаголовок, остальное — абзацы', () => {
    const blocks = textBlocks('О вакансии:\nКоманда платежей.\n\nЗадачи:\nРуководить развитием.');
    expect(blocks).toEqual([
      { kind: 'h', text: 'О вакансии' },
      { kind: 'p', text: 'Команда платежей.' },
      { kind: 'h', text: 'Задачи' },
      { kind: 'p', text: 'Руководить развитием.' },
    ]);
  });

  it('разметка **Заголовок** и «## Заголовок» — тоже подзаголовок', () => {
    expect(textBlocks('**Условия**\nДМС.\n## Что важно\nGo.')).toEqual([
      { kind: 'h', text: 'Условия' },
      { kind: 'p', text: 'ДМС.' },
      { kind: 'h', text: 'Что важно' },
      { kind: 'p', text: 'Go.' },
    ]);
  });

  it('пустой текст — пустой список', () => {
    expect(textBlocks('  \n\n ')).toEqual([]);
  });
});

describe('publishedLine', () => {
  it('источник и дата прописью', () => {
    expect(publishedLine('hh.ru', '2026-11-11T09:00:00Z', new Date('2026-11-16T00:00:00Z'))).toBe('hh.ru · опубликована 11 ноября');
  });
  it('прошлый год — с годом', () => {
    expect(publishedLine('hh.ru', '2025-02-03T09:00:00Z', new Date('2026-11-16T00:00:00Z'))).toBe('hh.ru · опубликована 3 февраля 2025');
  });
  it('даты нет — только источник', () => {
    expect(publishedLine('hh.ru', 'мусор')).toBe('hh.ru');
  });
});
