import { describe, expect, it } from 'vitest';
import { reviewLetterBody, type LetterGateSources } from './letterModelGate';
import { REVIEWED_LETTERS } from './letterReviewedCases.fixture';

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

  it('checks the first word where it can: Latin in a Russian letter', () => {
    expect(reviewLetterBody('Google доверил мне логистику.', RU_SOURCES).map((v) => v.rule)).toContain('name');
    // A name the vacancy or the profile has is fine at the start too.
    expect(reviewLetterBody('Bjak ищет руководителя операций.', RU_SOURCES)).toEqual([]);
  });

  it('checks the first word where it can: a name of two or more capitalised words', () => {
    expect(reviewLetterBody('Яндекс Маркет доверил мне логистику.', RU_SOURCES).map((v) => v.rule)).toContain('name');
    expect(reviewLetterBody('Goldman Leidos trusted me.', EN_SOURCES).map((v) => v.rule)).toContain('name');
  });

  it('does not read an ordinary opening as a name', () => {
    for (const body of [
      'Dear Leidos Team,',
      'Currently I work as Head of Engineering at Финтех Лаб.',
      'At Ритейл Системс I worked on logistics.',
      'Earlier I was Director of Engineering.',
    ]) {
      expect(reviewLetterBody(body, EN_SOURCES)).toEqual([]);
    }
    for (const body of ['В Финтех Лаб работаю с 2024 года.', 'Уважаемая команда Bjak!', 'Сейчас работаю в Финтех Лаб.']) {
      expect(reviewLetterBody(body, RU_SOURCES)).toEqual([]);
    }
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
      const sources: LetterGateSources = { language: 'ru', candidate: [statement], career: [], vacancy: [] };
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

const RU_PLACES: LetterGateSources = {
  language: 'ru',
  candidate: [
    'Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек',
    'Построение операционной модели и управление изменениями',
    'Единая система KPI для пяти направлений',
    'Сокращение срока выполнения заказа с 12 до 7 дней',
    'Уровень сервиса вырос с 91 до 97 %',
  ],
  career: [
    'Руководитель разработки Финтех Лаб 2024–по сей день',
    'Директор по разработке Маркет Софт 2021–2023',
    'Руководитель разработки Ритейл Системс 2014–2021',
  ],
  vacancy: ['VP Operations', 'Bjak'],
  places: [
    { employer: 'Финтех Лаб', statements: [] },
    { employer: 'Маркет Софт', statements: [] },
    { employer: 'Ритейл Системс', statements: ['Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек'] },
  ],
};
const EN_PLACES: LetterGateSources = {
  language: 'en',
  candidate: [
    'Warehouse and logistics for a nationwide retail chain, the team grew from 8 to 35 people',
    'Building the operating model and change management',
    'Order fulfilment time cut from 12 to 7 days',
  ],
  career: ['Head of Engineering Финтех Лаб 2024–present', 'Director of Engineering Маркет Софт 2021–2023', 'Head of Engineering Ритейл Системс 2014–2021'],
  vacancy: ['VP, Operations', 'Bjak'],
  places: [
    { employer: 'Финтех Лаб', statements: [] },
    { employer: 'Маркет Софт', statements: [] },
    { employer: 'Ритейл Системс', statements: ['Warehouse and logistics for a nationwide retail chain, the team grew from 8 to 35 people'] },
  ],
};
const rulesOf = (body: string, sources: LetterGateSources) => reviewLetterBody(body, sources).map((v) => v.rule);

describe('reviewLetterBody: the letters CPO read on 05.11', () => {
  for (const { letter, language, body } of REVIEWED_LETTERS) {
    it(`letter ${letter} never reaches the candidate`, () => {
      expect(reviewLetterBody(body, language === 'ru' ? RU_PLACES : EN_PLACES)).not.toEqual([]);
    });
  }
});

describe('reviewLetterBody: a result stays with its workplace', () => {
  it('stops a number from another place or from no place', () => {
    expect(rulesOf('В Маркет Софт срок выполнения заказа сократился с 12 до 7 дней.', RU_PLACES)).toContain('place');
    expect(rulesOf('В Ритейл Системс уровень сервиса вырос с 91 до 97 %.', RU_PLACES)).toContain('place');
  });

  it('lets through a number bound to the named place', () => {
    expect(rulesOf('В Ритейл Системс команда выросла с 8 до 35 человек.', RU_PLACES)).toEqual([]);
  });

  it('follows «там» and «there» to the place named before', () => {
    const body = 'Работал в Маркет Софт. Там срок выполнения заказа сократился с 12 до 7 дней.';
    expect(rulesOf(body, RU_PLACES)).toContain('place');
    expect(rulesOf('The work at Маркет Софт mattered. There fulfilment time fell from 12 to 7 days.', EN_PLACES)).toContain('place');
  });

  it('«там» with no place before it names nothing the letter can back', () => {
    expect(rulesOf('Там команда выросла с 8 до 35 человек.', RU_PLACES)).toContain('place');
  });

  it('«там, где» and «there is» are not a reference to a workplace', () => {
    expect(rulesOf('Это важно там, где срок выполнения заказа сократился с 12 до 7 дней.', RU_PLACES)).not.toContain('place');
    expect(rulesOf('There is a fact: fulfilment time fell from 12 to 7 days.', EN_PLACES)).not.toContain('place');
  });

  it('a record about the place itself is not a fact moved to it', () => {
    const sources = { ...RU_PLACES, candidate: [...RU_PLACES.candidate, 'Опыт работы\nМесто: Ритейл Системс'] };
    expect(rulesOf('В Ритейл Системс команда выросла с 8 до 35 человек.', sources)).toEqual([]);
  });

  it('stops a fact without a number moved to another place', () => {
    const body = 'В Финтех Лаб занимаюсь операционной моделью и управлением изменениями.';
    expect(rulesOf(body, RU_PLACES)).toContain('place');
  });
});

describe('reviewLetterBody: type of letter', () => {
  it('stops a list of all workplaces', () => {
    const body = 'Работал в Финтех Лаб. До этого был в Маркет Софт. Ещё раньше в Ритейл Системс.';
    expect(rulesOf(body, RU_PLACES)).toContain('biography');
  });

  it('stops a chronology of years', () => {
    expect(rulesOf('С 2014 по 2021 год работал в разработке.', RU_PLACES)).toContain('biography');
  });

  it('lets a letter name the places that prove something', () => {
    const body = 'В Ритейл Системс команда выросла с 8 до 35 человек. Единая система KPI для пяти направлений появилась в другой работе.';
    expect(rulesOf(body, RU_PLACES)).not.toContain('biography');
  });

  it('stops text that shows how the letter was built', () => {
    for (const body of ['Кандидату можно доверить эту задачу.', 'В фактах не указан опыт ITIL.', 'The candidate brings evidence.', 'The facts do not show ITIL.']) {
      expect(rulesOf(body, body.startsWith('The') ? EN_PLACES : RU_PLACES)).toContain('meta');
    }
  });
});

describe('reviewLetterBody: correct sentences stay', () => {
  it('a result that names no actor is not a personal claim', () => {
    expect(rulesOf('Срок выполнения заказа сократился с 12 до 7 дней.', RU_PLACES)).toEqual([]);
    expect(rulesOf('Уровень сервиса вырос с 91 до 97 %.', RU_PLACES)).toEqual([]);
  });

  it('what the candidate did not do is not a claim', () => {
    expect(rulesOf('Я не управлял сетями в энергетике.', RU_PLACES)).not.toContain('ownership');
    expect(rulesOf('I have not led a technology organization through a merger.', EN_PLACES)).not.toContain('ownership');
  });

  it('a sentence about the reader\'s job is not a claim about the candidate', () => {
    expect(rulesOf('The role requires building owners and timelines.', EN_PLACES)).not.toContain('ownership');
    expect(rulesOf('Роль требует управлять приоритетами группы.', RU_PLACES)).not.toContain('ownership');
    expect(rulesOf('My role was scaling owners and timelines.', EN_PLACES)).toContain('ownership');
  });

  it('a negative situation in a fact does not void the rest of that fact', () => {
    const fact = 'Склад не успевал за заказами: заказ шёл 12 дней. Я внедрил разбор просрочек. Срок сократился с 12 до 7 дней.';
    const sources: LetterGateSources = { language: 'ru', candidate: [fact], career: [], vacancy: [] };
    expect(rulesOf('Я внедрил разбор просрочек, и срок сократился с 12 до 7 дней.', sources)).toEqual([]);
  });

  it('a name from the vacancy text is not foreign', () => {
    const sources = { ...RU_PLACES, vacancy: [...RU_PLACES.vacancy, 'Группе ActAI нужна операционная модель.'] };
    expect(rulesOf('Первый разговор о том, как ActAI ведёт обзоры.', sources)).toEqual([]);
  });
});

describe('reviewLetterBody: gaps found in review, 05.11', () => {
  it('a sentence with a personal past verb is a claim even when it mentions a role', () => {
    expect(rulesOf('В роли директора основал отдел.', RU_PLACES)).toContain('ownership');
  });

  it('a reflexive verb of personal achievement stays a claim', () => {
    expect(rulesOf('Я добился роста отдела.', RU_PLACES)).toContain('ownership');
  });

  it('«не просто» and «not only» do not negate the claim', () => {
    expect(rulesOf('Я не просто создал отдел.', RU_PLACES)).toContain('ownership');
    expect(rulesOf('I not only led the unit.', EN_PLACES)).toContain('ownership');
  });

  it('ordinary phrases are not taken for text about the input', () => {
    expect(rulesOf('Я кандидат наук.', RU_PLACES)).not.toContain('meta');
    expect(rulesOf('Это важно в данных условиях.', RU_PLACES)).not.toContain('meta');
    expect(rulesOf('The first topic is the data platform.', EN_PLACES)).not.toContain('meta');
    expect(rulesOf('В данных нет этого опыта.', RU_PLACES)).toContain('meta');
  });

  it('«there is» in any form is not a reference to a workplace', () => {
    for (const body of ["There's a fact: fulfilment time fell from 12 to 7 days.", "There isn't a fact: fulfilment time fell from 12 to 7 days."]) {
      expect(rulesOf(body, EN_PLACES)).not.toContain('place');
    }
  });

  it('a name from the vacancy text backs what is said about the role, not the career', () => {
    const sources = { ...RU_PLACES, vacancyText: 'Мы партнёры Google и строим склады.' };
    expect(rulesOf('Работал с Google.', sources)).toContain('name');
    expect(rulesOf('Я работал с Google.', sources)).toContain('name');
    expect(rulesOf('Вашей роли важна работа с Google.', sources)).not.toContain('name');
  });
});
