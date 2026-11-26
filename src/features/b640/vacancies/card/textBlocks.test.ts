import { describe, expect, it } from 'vitest';
import { textBlocks } from './textBlocks';

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
