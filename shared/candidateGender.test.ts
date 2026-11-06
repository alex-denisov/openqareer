import { describe, expect, it } from 'vitest';
import { candidateGenderFromName } from './candidateGender';

describe('candidateGenderFromName', () => {
  it.each([
    ['Алексей Денисов', 'male'],
    ['Денисов Алексей', 'male'],
    ['Иван Петрович Сидоров', 'male'],
    ['Никита Белый', 'male'],
    ['Илья Кац', 'male'],
    ['Мария Иванова', 'female'],
    ['Иванова Мария Сергеевна', 'female'],
    ['Анна Абрамович', 'female'],
    ['Елена Ким', 'female'],
    ['Анна Герман', 'female'],
    ['Герман Анна', 'female'],
    ['Гульнара Ахметова', 'female'],
  ] as const)('русское имя: %s → %s', (name, gender) => {
    expect(candidateGenderFromName(name)).toBe(gender);
  });

  it.each([
    ['Alexey Denisov', 'male'],
    ['Sergey Ivanov', 'male'],
    ['Maria Ivanova', 'female'],
    ['Natalia Kuznetsova', 'female'],
    ['John Smith', 'male'],
    ['Carlos Medina', 'male'],
    ['Emma Martin', 'female'],
    ['Sarah Johnson', 'female'],
    ['Mohammed Al-Farsi', 'male'],
    ['Fatima Hassan', 'female'],
    ['Wei Ivanov', 'male'],
  ] as const)('латиница и иностранные имена: %s → %s', (name, gender) => {
    expect(candidateGenderFromName(name)).toBe(gender);
  });

  it.each([
    ['Саша Петрова', 'female'],
    ['Женя Смирнов', 'male'],
    ['Alex Denisov', 'male'],
    ['Sasha Volkova', 'female'],
    ['Лада Кузнецова', 'female'],
    ['Ахмет Мамедов', 'male'],
    ['Рашид Алиев оглы', 'male'],
    ['Лейла Алиева кызы', 'female'],
    ['Рустам Абдуллаевич Каримов', 'male'],
  ] as const)('неоднозначное имя решает фамилия или отчество: %s → %s', (name, gender) => {
    expect(candidateGenderFromName(name)).toBe(gender);
  });

  it.each([
    'Саша',
    'Женя Ким',
    'Alex',
    'Alex Kim',
    'Chris Taylor',
    'Taylor Morgan',
    'Андреа Росси',
    'Кристин Смит',
    'Wei Zhang',
    'Лада',
    'Мария Сергеевич Попова',
    'Иван Ивановна',
    '',
    '   ',
    'ООО Ромашка',
    'test.user@example.com',
  ])('нельзя определить, рода нет: «%s»', (name) => {
    expect(candidateGenderFromName(name)).toBeUndefined();
  });

  it.each(['Настя Мартин', 'Эмили Мартин', 'Тарас Щербина', 'Karen Avetisyan', 'Лада Кузьмина'])(
    'фамилия на -ин и -ина и имя обоих родов не определяют род: %s',
    (name) => {
      expect(candidateGenderFromName(name)).toBeUndefined();
    },
  );

  it('нет имени: рода нет', () => {
    expect(candidateGenderFromName(undefined)).toBeUndefined();
  });

  it('ё и регистр не мешают', () => {
    expect(candidateGenderFromName('АРТЁМ КОРОЛЁВ')).toBe('male');
    expect(candidateGenderFromName('артем королев')).toBe('male');
    expect(candidateGenderFromName('Таня Королёва')).toBe('female');
  });
});
