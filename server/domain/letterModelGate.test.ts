import { describe, expect, it } from 'vitest';
import { reviewLetterBody, type LetterGateSources } from './letterModelGate';

// Sentences below are the ones prod models wrote for the synthetic QA candidate on 04.11.
const RU_SOURCES: LetterGateSources = {
  language: 'ru',
  candidate: ['Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.'],
  career: [
    'Руководитель разработки в компании Финтех Лаб (2024–по сей день)',
    'Директор по разработке в компании Маркет Софт (2021–2023)',
    'Руководитель разработки в компании Ритейл Системс (2014–2021)',
  ],
  vacancy: ['VP Operations', 'Bjak'],
};

const EN_LATIN: LetterGateSources = {
  language: 'en',
  candidate: ['Worked in warehouse and logistics for a nationwide retail chain as the team grew from 8 to 35 people.'],
  career: ['Head of Engineering at Fintech Lab (2024–present)', 'Head of Engineering at Retail Systems (2014–2021)'],
  vacancy: ['Director, Technology Operations & Sustainment', 'Leidos'],
};

const EN_SOURCES: LetterGateSources = {
  language: 'en',
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

  it('lets a paraphrase through in English', () => {
    const body = [
      'I am writing about the Director, Technology Operations & Sustainment role at Leidos.',
      'I currently work as Head of Engineering at Fintech Lab.',
      'At Retail Systems I worked on warehouse and logistics for a nationwide retail chain as the team grew from 8 to 35 people.',
    ].join('\n\n');
    expect(reviewLetterBody(body, EN_LATIN)).toEqual([]);
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

  it('stops names the profile does not have', () => {
    const body = 'Окончил факультет в МГТУ имени Баумана.';
    expect(reviewLetterBody(body, RU_SOURCES).map((v) => v.rule)).toContain('name');
  });

  it('checks the first word where it can: Latin in a Russian letter', () => {
    expect(reviewLetterBody('Google доверил мне логистику.', RU_SOURCES).map((v) => v.rule)).toContain('name');
    // A name the vacancy or the profile has is fine at the start too.
    expect(reviewLetterBody('Bjak ищет руководителя операций.', RU_SOURCES)).toEqual([]);
  });

  it('checks the first word where it can: a name of two or more capitalised words', () => {
    expect(reviewLetterBody('Яндекс Маркет доверил мне логистику.', RU_SOURCES).map((v) => v.rule)).toContain('name');
    expect(reviewLetterBody('Goldman Leidos trusted me.', EN_LATIN).map((v) => v.rule)).toContain('name');
  });

  it('does not read an ordinary opening as a name', () => {
    for (const body of [
      'Dear Leidos Team,',
      'Currently I work as Head of Engineering at Fintech Lab.',
      'At Retail Systems I worked on logistics.',
      'Earlier I was Director of Engineering.',
    ]) {
      expect(reviewLetterBody(body, EN_LATIN)).toEqual([]);
    }
    for (const body of ['В Финтех Лаб работаю с 2024 года.', 'Уважаемая команда Bjak!', 'Сейчас работаю в Финтех Лаб.']) {
      expect(reviewLetterBody(body, RU_SOURCES)).toEqual([]);
    }
  });

  it('does not read a conjunction before a known name as a two-word name', () => {
    const sources = { ...RU_SOURCES, vacancy: [...RU_SOURCES.vacancy, 'DevOps'] };
    expect(reviewLetterBody('Если DevOps не связаны метриками, релизы падают.', sources)).toEqual([]);
  });

  it('what stays unchecked: one capitalised word that could open any sentence', () => {
    // Documented in the PR: without a dictionary «Сбер» and «Работал» look the same to the gate.
    expect(reviewLetterBody('Сбер доверил мне логистику.', RU_SOURCES)).toEqual([]);
    expect(reviewLetterBody('Google trusted me with logistics.', EN_SOURCES)).toEqual([]);
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

  it('a negated or unconfirmed fact backs nothing', () => {
    for (const statement of ['Я не увеличил выручку на 20%.', 'Не могу подтвердить: я увеличил выручку на 20%.']) {
      const sources: LetterGateSources = { language: 'ru', candidate: [statement], career: [], vacancy: [] };
      expect(reviewLetterBody('Выручка выросла на 20%.', sources).map((v) => v.rule)).toContain('number');
    }
  });

  it('a negative situation in a fact does not void the rest of that fact', () => {
    const fact = 'Склад не успевал за заказами: заказ шёл 12 дней. Срок сократился с 12 до 7 дней.';
    const sources: LetterGateSources = { language: 'ru', candidate: [fact], career: [], vacancy: [] };
    expect(reviewLetterBody('Срок сократился с 12 до 7 дней.', sources)).toEqual([]);
  });

  it('a range shares its percent sign: 91 to 97 % backs 91 %', () => {
    const sources = { ...RU_SOURCES, candidate: ['Повышение уровня сервиса с 91 до 97 %.'] };
    expect(reviewLetterBody('Уровень сервиса вырос с 91% до 97%.', sources)).toEqual([]);
    expect(reviewLetterBody('Уровень сервиса вырос с 91 до 97 %.', sources)).toEqual([]);
    expect(reviewLetterBody('Уровень сервиса вырос с 90% до 97%.', sources).map((v) => v.rule)).toContain('number');
  });

  it('names a violation by its sentence and no more than once per rule and sentence', () => {
    const violations = reviewLetterBody('Выросла до 50 и 60 человек. Всё хорошо.', RU_SOURCES);
    expect(violations).toEqual([{ rule: 'number', sentence: 'Выросла до 50 и 60 человек.' }]);
  });
});

describe('reviewLetterBody: the vacancy text backs the role, not the career', () => {
  const sources = { ...RU_SOURCES, vacancyText: 'Мы партнёры Google, у нас 500 складов.' };
  const rulesOf = (body: string) => reviewLetterBody(body, sources).map((v) => v.rule);

  it('a name or number from the text is fine when said about the role', () => {
    expect(rulesOf('Вашей роли важна работа с Google.')).toEqual([]);
    expect(rulesOf('Вам нужно удержать 500 складов.')).toEqual([]);
  });

  it('the same name or number is foreign when it is the candidate\'s past', () => {
    expect(rulesOf('Я работал с Google.')).toContain('name');
    expect(rulesOf('Работал с Google.')).toContain('name');
    expect(rulesOf('Я управлял 500 складами.')).toContain('number');
  });
});

describe('reviewLetterBody: an English letter from a Russian profile', () => {
  const sources: LetterGateSources = {
    ...EN_SOURCES,
    candidate: ['Бюджет 2 млрд ₽, команда выросла с 8 до 35 человек.'],
  };

  it('accepts a Latin employer, ordinary capitals and a translated unit', () => {
    expect(reviewLetterBody('At Fintech Lab in Moscow I reported to the CEO.', sources)).toEqual([]);
    expect(reviewLetterBody('I ran a 2 bn RUB budget.', sources)).toEqual([]);
  });

  it('stops a number the profile does not have', () => {
    expect(reviewLetterBody('I ran a 3 bn RUB budget.', sources).map((v) => v.rule)).toEqual(['number']);
  });

  it('stops Cyrillic left in the letter', () => {
    expect(reviewLetterBody('I worked at Финтех Лаб.', sources).map((v) => v.rule)).toEqual(['language']);
  });
});

describe('reviewLetterBody: meaning stays with the reader', () => {
  it('does not judge an opinion or a personal verb: the candidate reads the draft', () => {
    expect(reviewLetterBody('Обычно такие проекты ломаются на передаче между командами.', RU_SOURCES)).toEqual([]);
    expect(reviewLetterBody('I built the operating model for this kind of team.', EN_LATIN)).toEqual([]);
  });
});
