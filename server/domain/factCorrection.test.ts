import { describe, expect, it } from 'vitest';
import {
  applyStated,
  correctedCopy,
  suggestedCopy,
  numberChanges,
  statedCorrection,
  withoutWriteClaims,
} from './factCorrection';

const BULLET = 'Grew revenue from RUB 230M to RUB 920M and margin from 16% to 80%, SLA 99.5%';
const changesOf = (after: string, before = BULLET) => numberChanges(before, after)!;

describe('B796: копии исправленного факта', () => {
  const changes = changesOf(BULLET.replace('80%', '40%'));

  it('находит перевод по паре чисел и меняет только исправленное', () => {
    expect(correctedCopy('Рентабельность выросла с 16% до 80% за год', changes)).toBe(
      'Рентабельность выросла с 16% до 40% за год',
    );
    expect(correctedCopy('Открыто: маржа 16 % до 80 %?', changes)).toBe(
      'Открыто: маржа 16 % до 40 %?',
    );
  });

  it('чужие 80 % не трогает', () => {
    expect(correctedCopy('Margin from 16% to 80%', changes, 'other')).toBeNull();
    expect(correctedCopy('CSAT from 25% to 80%', changes)).toBeNull();
    expect(correctedCopy('Сократил обращения на 80%', changes)).toBeNull();
  });

  it('убранная база убирается и в копии', () => {
    const dropped = changesOf(BULLET.replace('from 16% to 80%', 'to 40%'));
    expect(correctedCopy('Рентабельность выросла с 16% до 80% за год', dropped)).toBe(
      'Рентабельность выросла до 40% за год',
    );
    expect(correctedCopy('margin from 16% to 80%', dropped)).toBe('margin to 40%');
  });

  it('без пары узнаёт копию по словам рядом', () => {
    const one = changesOf('Reached operating margin of 40%', 'Reached operating margin of 80%');
    expect(correctedCopy('Operating margin reached 80% in 2023', one, 'same')).toBe(
      'Operating margin reached 40% in 2023',
    );
    expect(correctedCopy('Operating margin reached 80% in 2023', one)).toBeNull();
    expect(suggestedCopy('Operating margin reached 80% in 2023', one)).not.toBeNull();
    expect(correctedCopy('Automated 80% of tickets', one, 'same')).toBeNull();
    const support = changesOf(
      'Автоматизировал 40% обращений в поддержку',
      'Автоматизировал 80% обращений в поддержку',
    );
    const cut = 'Сократил обращения в поддержку на 80%';
    expect(correctedCopy(cut, support, 'same')).toBeNull();
    expect(suggestedCopy(cut, support)).not.toBeNull();
  });

  it('правка слов чисел не меняет, а лишнее число не угадывается', () => {
    expect(numberChanges('вёл 3 проекта', 'руководил 3 проектами')).toEqual([]);
    expect(numberChanges('вёл 3 проекта', 'вёл 4 проекта из 9')).toBeNull();
  });
});

describe('B796: исправление словами кандидата', () => {
  it.each([
    ['Рентабельность не 80%, а 40%', '80', '40'],
    ['В Россетях было 40 %, а не 80 %', '80', '40'],
    ['вместо 80 процентов поставь 40', '80', '40'],
    ['Исправь 80% на 40%', '80', '40'],
  ])('%s', (message, from, to) => {
    expect(statedCorrection(message)).toEqual({ from, to });
  });

  it('рассказ и пара чисел в тексте правкой не считаются', () => {
    expect(statedCorrection('Поднял маржу с 16 на 40 процентов')).toBeNull();
    expect(applyStated('80% и ещё 80%', { from: '80', to: '40' }, true)).toBeNull();
    expect(applyStated('80 человек, 80%', { from: '80', to: '40' }, true)).toBe('80 человек, 40%');
  });
});

describe('B796: консультант не говорит о записи, которой не было', () => {
  it('ложный успех заменён', () => {
    const text = withoutWriteClaims('Понял. Меняю цифру в двух местах. Что дальше?', true);
    expect(text).not.toContain('Меняю');
    expect(text).toContain('Что дальше?');
    expect(text).toContain('«Применить»');
    expect(withoutWriteClaims('Исправлено.', false)).toContain('не меняю');
  });

  it('под карточкой отказ и просьба внести вручную заменены', () => {
    const reply =
      'Понял: рентабельность 40 %. Саму правку в двух местах вносите в карточке профиля — текст за вас я не меняю. Что дальше?';
    const text = withoutWriteClaims(reply, true);
    expect(text).not.toMatch(/не меняю|вносите/u);
    expect(text).toContain('Понял: рентабельность 40 %.');
    expect(text).toContain('Что дальше?');
    expect(text).toContain('после «Применить»');
    expect(withoutWriteClaims('Исправьте цифру в резюме вручную.', true)).toContain('«Применить»');
    expect(withoutWriteClaims(reply, false)).toBe(reply);
  });

  it('верный ответ о карточке и чужое «не меняю» остаются', () => {
    for (const text of [
      'Правка готова ниже: внесите её кнопкой «Применить».',
      'Я не меняю мнение: роль вам подходит.',
      'Лучше не менять компанию до весны.',
    ])
      expect(withoutWriteClaims(text, true)).toBe(text);
  });

  it('рассказ о работе кандидата остаётся', () => {
    const text = 'Вы изменили процесс и обновили команду.';
    expect(withoutWriteClaims(text, true)).toBe(text);
  });
});
