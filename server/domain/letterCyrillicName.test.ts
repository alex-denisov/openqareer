import { describe, expect, it } from 'vitest';
import { russianProperName } from './letterCyrillicName';

describe('russianProperName (B714)', () => {
  it.each([
    ['Alexey Denisov', 'Алексей Денисов'],
    ['Ivan Petrov', 'Иван Петров'],
    ['Dmitry Ivanov', 'Дмитрий Иванов'],
    ['Yulia Smirnova', 'Юлия Смирнова'],
    ['Sergey Kuznetsov', 'Сергей Кузнецов'],
    ['Mikhail Zhukov', 'Михаил Жуков'],
    ['Yuriy Shcherbakov', 'Юрий Щербаков'],
    ['Anna-Maria Lee', 'Анна-Мария Лее'],
  ])('%s → %s', (latin, cyrillic) => {
    expect(russianProperName(latin)).toBe(cyrillic);
  });

  it('кириллицу не трогает', () => {
    expect(russianProperName('Алексей Денисов')).toBe('Алексей Денисов');
  });
});
