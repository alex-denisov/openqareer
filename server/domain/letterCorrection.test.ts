import { describe, expect, it } from 'vitest';
import { gateRules, letterCorrection } from './letterCorrection';

describe('letterCorrection (B640): причина отказа одной фразой для второго вызова', () => {
  it('читает правила из отказа проверки и пропускает прочие отказы', () => {
    expect(gateRules('letter_gate:name,number')).toEqual(['name', 'number']);
    expect(gateRules('timeout')).toEqual([]);
    expect(gateRules(undefined)).toEqual([]);
  });

  it('называет причину: переведённые названия и чужое имя', () => {
    const text = letterCorrection(['name']);
    expect(text).toContain('Не переводи и не меняй названия работодателей');
    expect(text).toContain('не называй других имён');
  });

  it('по одной фразе на правило, резюме — по тому, приложено ли оно', () => {
    expect(letterCorrection(['number', 'number', 'resume'])).toBe(
      'Прошлый вариант письма отклонён. Не пиши цифр, которых нет в профиле кандидата: каждая цифра письма должна стоять в профиле. Последней фразой перед подписью скажи, что резюме приложено.',
    );
    expect(letterCorrection(['resume'], false)).toContain('Не упоминай резюме');
    expect(letterCorrection(['unknown'])).toBe(undefined);
  });
});
