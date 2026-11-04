import { describe, expect, it } from 'vitest';
import { reviewLetterBody, type LetterGateSources } from './letterModelGate';

// Sentences below are the ones prod models wrote for the synthetic QA candidate on 04.11.
const RU_SOURCES: LetterGateSources = {
  candidate: ['Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.'],
  career: [
    'Руководитель разработки в компании Финтех Лаб (2024–по сей день)',
    'Директор по разработке в компании Маркет Софт (2021–2023)',
    'Руководитель разработки в компании Ритейл Системс (2014–2021)',
  ],
  vacancy: ['VP Operations', 'Bjak'],
};

const EN_SOURCES: LetterGateSources = {
  candidate: ['Worked in warehouse and logistics for a nationwide retail chain as the team grew from 8 to 35 people.'],
  career: [
    'Head of Engineering at Финтех Лаб (2024–present)',
    'Director of Engineering at Маркет Софт (2021–2023)',
    'Head of Engineering at Ритейл Системс (2014–2021)',
  ],
  vacancy: ['Director, Technology Operations & Sustainment', 'Leidos'],
};

describe('reviewLetterBody: what a model letter may say', () => {
  it('lets a paraphrase of the profile through in Russian', () => {
    const body = [
      'Здравствуйте! Заинтересовала вакансия VP Operations в компании Bjak.',
      'Сейчас я руководитель разработки в компании Финтех Лаб (с 2024 года), до этого был директором по разработке в компании Маркет Софт.',
      'В компании Ритейл Системс занимался складом и логистикой для федеральной сети магазинов, команда выросла с 8 до 35 человек.',
      'Буду рад обсудить задачи роли.',
    ].join('\n\n');
    expect(reviewLetterBody(body, RU_SOURCES)).toEqual([]);
  });

  it('lets a paraphrase through in English with the employers as the candidate wrote them', () => {
    const body = [
      'Dear Leidos Team,',
      'I am writing about the Director, Technology Operations & Sustainment role.',
      'I currently work as Head of Engineering at Финтех Лаб, and earlier I was Director of Engineering at Маркет Софт.',
      'At Ритейл Системс I worked on warehouse and logistics for a nationwide retail chain as the team grew from 8 to 35 people.',
      'I would be glad to discuss the role.',
    ].join('\n\n');
    expect(reviewLetterBody(body, EN_SOURCES)).toEqual([]);
  });

  it('treats a declined employer as the same name', () => {
    const body = 'Работал в Финтех Лабе и в Ритейл Системсе.';
    expect(reviewLetterBody(body, RU_SOURCES)).toEqual([]);
  });

  it('treats a declined job title as the same words, and a greeting as no name', () => {
    expect(reviewLetterBody('С 2024 года занимаю должность Руководителя разработки в Финтех Лаб.', RU_SOURCES)).toEqual([]);
    expect(reviewLetterBody('Ранее работал Директором по разработке.', RU_SOURCES)).toEqual([]);
    expect(reviewLetterBody('Dear Hiring Lead,', EN_SOURCES)).toEqual([]);
  });

  it('stops a transliterated or translated employer', () => {
    const body = 'Currently, I serve as Head of Engineering at Fintech Lab.';
    expect(reviewLetterBody(body, EN_SOURCES)).toEqual([expect.objectContaining({ rule: 'name' })]);
  });

  it('stops names the profile does not have', () => {
    const body = 'Окончил факультет в МГТУ имени Баумана.';
    expect(reviewLetterBody(body, RU_SOURCES).map((v) => v.rule)).toContain('name');
  });

  it('stops months that are not in the profile', () => {
    const body = 'С марта работал в компании Ритейл Системс.';
    expect(reviewLetterBody(body, RU_SOURCES)).toEqual([expect.objectContaining({ rule: 'name' })]);
  });

  it('stops a number the profile does not have', () => {
    const violations = reviewLetterBody('Команда выросла до 50 человек.', RU_SOURCES);
    expect(violations).toEqual([expect.objectContaining({ rule: 'number' })]);
  });

  it('stops numbers taken in the wrong order', () => {
    const violations = reviewLetterBody('Команда сократилась с 35 до 8 человек.', {
      ...RU_SOURCES,
      candidate: ['Сократил команду с 8 до 35 человек.'],
    });
    expect(violations.map((v) => v.rule)).toContain('number');
  });

  it('keeps units apart: 40 million does not prove 40 percent', () => {
    const violations = reviewLetterBody('Вырос на 40%.', { ...RU_SOURCES, candidate: ['Бюджет 40 млн рублей.'] });
    expect(violations.map((v) => v.rule)).toContain('number');
  });

  it('accepts a currency written before or after the number, but not another currency', () => {
    const sources = { ...RU_SOURCES, candidate: ['Бюджет 40$.'] };
    expect(reviewLetterBody('Бюджет $40.', sources)).toEqual([]);
    expect(reviewLetterBody('Бюджет 40€.', sources).map((v) => v.rule)).toContain('number');
  });

  it('a negative number is not the positive one', () => {
    const sources = { ...RU_SOURCES, candidate: ['Выручка изменилась на -20%.'] };
    expect(reviewLetterBody('Выручка изменилась на 20%.', sources).map((v) => v.rule)).toContain('number');
  });

  it('does not read a range as a negative number', () => {
    const sources = { ...RU_SOURCES, candidate: ['Команда от 8-35 человек.'] };
    expect(reviewLetterBody('Команда от 8 до 35 человек.', sources)).toEqual([]);
  });

  it('stops ownership the fact does not state: the team grew is not I scaled the team', () => {
    const body = 'At Ритейл Системс I scaled the team from 8 to 35 people.';
    expect(reviewLetterBody(body, EN_SOURCES)).toEqual([expect.objectContaining({ rule: 'ownership' })]);
  });

  it('stops the -ing forms of the same claims', () => {
    expect(reviewLetterBody('I was involved in leading engineering teams.', EN_SOURCES).map((v) => v.rule)).toEqual(['ownership']);
    expect(reviewLetterBody('I worked on directing engineering efforts.', EN_SOURCES).map((v) => v.rule)).toEqual(['ownership']);
  });

  it('stops I grew the team when only the team grew', () => {
    const body = 'At Ритейл Системс I grew the team from 8 to 35 people.';
    expect(reviewLetterBody(body, EN_SOURCES)).toEqual([expect.objectContaining({ rule: 'ownership' })]);
  });

  it('an action verb is allowed when the candidate states that action', () => {
    const sources = { ...EN_SOURCES, candidate: ['Built logistics for a retail chain.'] };
    expect(reviewLetterBody('I built logistics for a retail chain.', sources)).toEqual([]);
  });

  it('a job title backs the matching action in Russian', () => {
    expect(reviewLetterBody('Я руководил разработкой в компании Финтех Лаб.', RU_SOURCES)).toEqual([]);
  });

  it('another subject of the same verb backs nothing', () => {
    const sources = { ...RU_SOURCES, candidate: ['Заказчик создал проект Atlas.'] };
    expect(reviewLetterBody('Я создал проект Atlas.', sources).map((v) => v.rule)).toContain('ownership');
  });

  it('a negated or unconfirmed fact backs nothing', () => {
    for (const statement of [
      'I have not created project Atlas.',
      'Я не увеличил выручку на 20%.',
      'Не могу подтвердить: я увеличил выручку на 20%.',
    ]) {
      const sources = { candidate: [statement], career: [], vacancy: [] };
      expect(reviewLetterBody('Я увеличил выручку на 20%, I created project Atlas.', sources)).not.toEqual([]);
    }
  });

  it('the vacancy text never backs what the candidate did', () => {
    const sources = { ...EN_SOURCES, vacancy: ['Led operations of 500 sites'] };
    const rules = reviewLetterBody('I led operations of 500 sites.', sources).map((v) => v.rule);
    expect(rules).toContain('ownership');
    expect(rules).toContain('number');
  });

  it('stops self-praise the profile cannot back', () => {
    for (const body of [
      'With extensive leadership experience I can help.',
      'I have a proven track record in operations.',
      'Мой обширный опыт поможет команде.',
      'У меня многолетний опыт руководства.',
    ]) {
      expect(reviewLetterBody(body, EN_SOURCES).map((v) => v.rule)).toContain('praise');
    }
  });

  it('names a violation by its sentence and no more than once per rule and sentence', () => {
    const violations = reviewLetterBody('Выросла до 50 и 60 человек. Всё хорошо.', RU_SOURCES);
    expect(violations).toEqual([{ rule: 'number', sentence: 'Выросла до 50 и 60 человек.' }]);
  });
});
