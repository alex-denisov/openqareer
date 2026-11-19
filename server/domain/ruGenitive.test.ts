import { describe, expect, it } from 'vitest';
import { genitiveFullName } from './ruGenitive';

describe('B697: родительный падеж ФИО', () => {
  it.each([
    ['Игорь Шаталов', 'Игоря Шаталова'],
    ['Анна Петрова', 'Анны Петровой'],
    ['Дмитрий Ковальский', 'Дмитрия Ковальского'],
    ['Мария Левицкая', 'Марии Левицкой'],
    ['Никита Орлов', 'Никиты Орлова'],
    ['Jane Roe', 'Jane Roe'],
  ])('%s → %s', (name, expected) => expect(genitiveFullName(name)).toBe(expected));
});
