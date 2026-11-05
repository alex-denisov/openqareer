import { describe, expect, it } from 'vitest';
import { plainCoachText } from './coachPlainText';

describe('служебные метки не доходят до кандидата (B511 Д6)', () => {
  it('заглавные метки доказательности становятся обычными словами', () => {
    expect(plainCoachText('Но пока это НЕИЗВЕСТНО: данных нет.')).toBe('Но пока это неизвестно: данных нет.');
    expect(plainCoachText('ФАКТ: релиз с 14 до 3 дней. ГИПОТЕЗА: роль подойдёт.')).toBe(
      'Факт: релиз с 14 до 3 дней. Гипотеза: роль подойдёт.',
    );
    expect(plainCoachText('Это ГИПОТЕЗЫ и ФАКТЫ.')).toBe('Это гипотезы и факты.');
  });

  it('не трогает слова внутри текста и обычный регистр', () => {
    const text = 'Факт есть, это неизвестно, компания ФАКТОРИЯ и НЕИЗВЕСТНЫЙ-ТЕРМИН.';
    expect(plainCoachText('Факт есть, это неизвестно.')).toBe('Факт есть, это неизвестно.');
    expect(plainCoachText(text)).toContain('ФАКТОРИЯ');
  });

  it('убирает ссылки на записи контекста', () => {
    expect(plainCoachText('Рост до 97% (memory:imp_abc-1) подтверждён [star:f4131add-c47a].')).toBe(
      'Рост до 97% подтверждён.',
    );
    expect(plainCoachText('См. document:8d2c, это важно')).toBe('См., это важно');
  });

  it('заменяет имена полей контекста обычными словами', () => {
    expect(plainCoachText('В knowledgeContext.confirmedFacts этого нет.')).toBe('В профиле этого нет.');
    expect(plainCoachText('По `starStories` видно историю.')).toBe('По профилю видно историю.');
    expect(plainCoachText('Факт (source=imported) из резюме.')).toBe('Факт из резюме.');
  });

  it('ссылки в обычном тексте и время не считаются метками', () => {
    const text = 'Смотрите https://hh.ru/vacancy/1, встреча 12:30, market: рынок.';
    expect(plainCoachText(text)).toBe(text);
  });
});
