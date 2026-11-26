import { describe, expect, it } from 'vitest';
import { knownAnswers, skillYearAnswers, standardQuestions } from './manualApplyQuestions';

const NOW = new Date('2026-11-25T00:00:00Z');

describe('типовые вопросы ручного отклика', () => {
  it('спрашивает контакты, опыт по навыкам, право на работу, визу, зарплату и срок выхода', () => {
    const texts = standardQuestions({
      vacancyId: 'v1',
      skills: ['Kafka', 'kafka '],
      location: 'Берлин, Германия',
    }).map((question) => question.text);
    expect(texts).toEqual([
      'Полное имя',
      'Электронная почта',
      'Телефон',
      'Город',
      'Сколько лет опыта: Kafka?',
      'Есть право на работу: Германия?',
      'Нужна рабочая виза: Германия?',
      'Ожидаемая зарплата',
      'Когда можете выйти на работу?',
    ]);
  });

  it('считает годы только по местам, где записан навык, и не складывает одновременные', () => {
    const places = [
      { startDate: '2020-01', endDate: '2021-12', current: false, skills: ['Kafka'] },
      { startDate: '2021-01', endDate: '2022-12', current: false, skills: ['kafka'] },
      { startDate: '2010-01', endDate: '2019-12', current: false, skills: ['Java'] },
      { startDate: '2005', endDate: '2009', current: false, skills: ['Kafka'] },
    ];
    expect(skillYearAnswers(['Kafka', 'Go'], places, NOW).map((item) => item.text)).toEqual(['3']);
  });

  it('повторно отвечать не просит: прошлый ответ кандидата главнее подсчёта', () => {
    const questions = standardQuestions({
      vacancyId: 'v1',
      skills: ['Kafka'],
      location: 'Берлин, Германия',
    });
    const years = skillYearAnswers(
      ['Kafka'],
      [{ startDate: '2024-01', current: true, skills: ['Kafka'] }],
      NOW,
    );
    const answers = knownAnswers(
      questions,
      [
        { questionId: years[0]!.questionId, text: '5' },
        { questionId: 'std-start', text: 'Через месяц' },
        { questionId: 'чужой', text: 'x' },
      ],
      years,
    );
    expect(answers.map((item) => item.text)).toEqual(['5', 'Через месяц']);
  });

  it('ответ о праве на работу в одной стране не подставляется для другой', () => {
    const german = standardQuestions({ vacancyId: 'v1', skills: [], location: 'Берлин, Германия' });
    const french = standardQuestions({ vacancyId: 'v1', skills: [], location: 'Париж, Франция' });
    const right = german.find((question) => question.text.startsWith('Есть право'))!;
    expect(knownAnswers(french, [{ questionId: right.id, text: 'Да' }], [])).toEqual([]);
  });
});
