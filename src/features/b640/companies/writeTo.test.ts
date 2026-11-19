import { describe, expect, it } from 'vitest';
import { writeToLabel } from './writeTo';

describe('writeToLabel', () => {
  it.each([
    ['Роман Ефимов', 'Написать Роману'],
    ['Андрей Орлов', 'Написать Андрею'],
    ['Дмитрий Орлов', 'Написать Дмитрию'],
    ['Павел Орлов', 'Написать Павлу'],
    ['Наталья Седова', 'Написать Наталье'],
    ['Мария Седова', 'Написать Марии'],
    ['Никита Седов', 'Написать Никите'],
  ])('%s → %s', (name, label) => {
    expect(writeToLabel(name)).toBe(label);
  });

  it('имя, которое не склоняем уверенно, — «знакомому»', () => {
    expect(writeToLabel('Любовь Седова')).toBe('Написать знакомому');
    expect(writeToLabel('Али')).toBe('Написать знакомому');
    expect(writeToLabel('  ')).toBe('Написать знакомому');
  });
});
