import { describe, expect, it } from 'vitest';
import { reviewLetterBody, type LetterGateSources } from './letterModelGate';

const SOURCES: LetterGateSources = {
  language: 'ru',
  candidate: [
    'LOCATION: Дубай',
    '## Директор | Завод Тюмень | Казань | 2016 — 2020',
    'Не рассматриваю переезд в Омск.',
  ],
  vacancy: [
    'Директор, ЭР-Телеком Холдинг, Мария Орлова',
    'Москва, Екатеринбург, Пермь, Тюмень или Омск. Офис Казань. Moscow, Dubai, Иннополис. Perm, Open, Director, The, Dear',
  ],
  vacancyLocation: 'Пермь, Иннополис, Россия',
  vacancyNames: ['Директор по развитию', 'ЭР-Телеком Холдинг', 'Мария Орлова'],
};
const flagged = (body: string, extra: Partial<LetterGateSources> = {}) =>
  reviewLetterBody(`${body}\n\nРезюме приложено.`, { ...SOURCES, ...extra }).some(
    (item) => item.rule === 'place',
  );

describe('письмо называет только места кандидата', () => {
  it.each([
    'Готов рассмотреть роль в Москве, Екатеринбурге, Перми, Тюмени или Омске.',
    'Готов к переезду.',
    'Интересна работа в Москве.',
    'Рассматриваю роль в Омске.',
    'Буду полезен в Иннополисе.',
    'Здравствуйте, готов рассмотреть роль в Перми.',
    'I am open to a role in Moscow.',
    'Happy to relocate.',
    'Готов рассмотреть работу в команде в Перми.',
  ])('останавливает: %s', (body) => expect(flagged(body)).toBe(true));

  it.each([
    'Здравствуйте, команда ЭР-Телеком Холдинг, Пермь!',
    'Откликаюсь на вакансию в ЭР-Телеком Холдинг в Перми.',
    'Буду рад обсудить задачи команды в Перми.',
    'Пишу в ваш офис в Москве.',
    'Запустил производство в Казани и Тюмени.',
    'I am based in Dubai.',
    'Готов рассмотреть работу в Дубае.',
    'Перед вами опыт операционного директора на рынке России.',
    'Порт и склад работали круглосуточно.',
    'Готов обсудить, чем могу быть полезен.',
  ])('пропускает: %s', (body) => expect(flagged(body)).toBe(false));

  it('город в названии компании — не место кандидата', () => {
    const names = { vacancyNames: ['Директор', 'Банк Москвы'] };
    expect(flagged('Откликаюсь на вакансию в Банк Москвы.', names)).toBe(false);
    expect(flagged('Откликаюсь на вакансию в Банке Москвы.', names)).toBe(false);
    expect(flagged('Готов рассмотреть роль в Москве.', names)).toBe(true);
  });

  it('условия поиска подтверждают город и переезд', () => {
    expect(flagged('Готов рассмотреть роль в Перми.', { conditions: ['Perm'] })).toBe(false);
    expect(flagged('Готов к переезду.', { conditions: ['Релокация'] })).toBe(false);
    expect(flagged('Готов к переезду.', { conditions: ['Не готов к переезду'] })).toBe(true);
  });
});
