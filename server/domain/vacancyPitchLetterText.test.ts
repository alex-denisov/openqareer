import { describe, expect, it } from 'vitest';
import { letterFactsToTranslate, resultFirst } from './letterResults';
import { generateVacancyPitch, type VacancyPitchInputFact } from './vacancyPitchService';

const record = (id: string, statement: string): VacancyPitchInputFact => ({
  id, statement, kind: 'fact', domain: 'experience', sourceMessageIds: ['m'], status: 'confirmed',
});

const facts = [
  record('edu', 'Образование\nУчебное заведение: МГТУ им. Баумана\nНачало: 2008-09\nОкончание: 2013-06'),
  record('lang', 'Язык\nЯзык: Английский\nУровень CEFR: C1'),
  record('out', 'Сократил релизный цикл с 14 до 3 дней'),
];
const workplaces = [
  { employer: 'Финтех Лаб', title: 'Head of Engineering', startDate: '2024-01', endDate: null, current: true, evidenceIds: ['wp1'] },
  { employer: 'Маркет Софт', title: 'Директор по разработке', startDate: '2021-02', endDate: '2023-12', current: false, evidenceIds: ['wp2'] },
];
const RAW_FIELD = /(Учебное заведение|Уровень CEFR|Начало|Окончание):/u;

describe('letter text (B496/B528)', () => {
  it('Russian vacancy → Russian letter without raw profile fields, built from workplaces', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'v', title: 'Head of Platform', company: 'Вектор Банк', responsibilities: ['Развивать платформу'], requiredSkills: ['Kafka'] },
      facts, workplaces,
    });
    expect(pitch.language).toBe('ru');
    expect(pitch.atsCoverLetter).not.toMatch(RAW_FIELD);
    expect(pitch.emailPitch.body).not.toMatch(RAW_FIELD);
    expect(pitch.atsCoverLetter).toContain('Сейчас работаю на позиции Руководитель разработки в компании Финтех Лаб');
    expect(pitch.usedEvidenceIds).toEqual(expect.arrayContaining(['wp1', 'wp2']));
    for (const notice of pitch.notices) expect(notice).toMatch(/\p{Script=Cyrillic}/u);
  });

  it('English vacancy → English letter, no raw fields, no Cyrillic, notices stay Russian', () => {
    const pitch = generateVacancyPitch({
      vacancy: { id: 'v', title: 'Director, Technology Operations', company: 'Leidos', requiredSkills: ['ITIL'] },
      facts, workplaces,
    });
    expect(pitch.language).toBe('en');
    expect(pitch.atsCoverLetter).not.toMatch(RAW_FIELD);
    expect(pitch.atsCoverLetter).not.toMatch(/\p{Script=Cyrillic}{3,}\s*:/u);
    expect(pitch.atsCoverLetter).toContain('Head of Engineering at Финтех Лаб');
    expect(pitch.atsCoverLetter).toContain('Director of Engineering at Маркет Софт');
    // Кириллица остаётся только в названиях компаний, и без кавычек (G3c).
    expect(pitch.atsCoverLetter).not.toContain('"');
    expect(pitch.atsCoverLetter.replace(/Финтех Лаб|Маркет Софт/gu, '')).not.toMatch(/\p{Script=Cyrillic}/u);
    expect(pitch.unconfirmedRequirements).toEqual(['ITIL']);
    for (const notice of pitch.notices) expect(notice).toMatch(/\p{Script=Cyrillic}/u);
  });
});

describe('letter text after G3c (04.11)', () => {
  const leidos = { id: 'v', title: 'Director, Technology Operations', company: 'Leidos' };
  const vector = { id: 'v', title: 'Руководитель платформы', company: 'Вектор Банк' };
  const outcome = (statement: string) => [{ ...record('out', statement), domain: 'outcome' }];

  it('every job title of a Russian letter is in Russian', () => {
    const places = [
      { employer: 'А', title: 'Head of Engineering', startDate: '2024-01', endDate: null, current: true, evidenceIds: ['a'] },
      { employer: 'Б', title: 'Director of Product', startDate: '2021-01', endDate: '2023-01', current: false, evidenceIds: ['b'] },
      { employer: 'В', title: 'VP of Sales', startDate: '2019-01', endDate: '2021-01', current: false, evidenceIds: ['c'] },
    ];
    const body = generateVacancyPitch({ vacancy: vector, facts: [], workplaces: places }).emailPitch.body;
    expect(body).toContain('Руководитель разработки в компании А');
    expect(body).toContain('Директор по продукту в компании Б');
    expect(body).toContain('Вице-президент по продажам в компании В');
  });

  it('an English title with no honest Russian stays as the candidate wrote it', () => {
    const places = [{ employer: 'А', title: 'Staff Wizard', startDate: '2024-01', endDate: null, current: true, evidenceIds: ['a'] }];
    expect(generateVacancyPitch({ vacancy: vector, facts: [], workplaces: places }).emailPitch.body).toContain('Staff Wizard в компании А');
  });

  it('a result reads as an achievement: the outcome first, in lower case after the colon', () => {
    const body = generateVacancyPitch({
      vacancy: vector,
      facts: outcome('Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.'),
    }).emailPitch.body;
    expect(body).toContain('Из результатов: команда выросла с 8 до 35 человек — склад и логистика для федеральной сети магазинов.');
  });

  it('a sentence that already says what was done keeps its order', () => {
    const body = generateVacancyPitch({ vacancy: vector, facts: outcome('Запустил платформу, сократив релизный цикл на 30%.') }).emailPitch.body;
    expect(body).toContain('Из результатов: запустил платформу, сократив релизный цикл на 30%.');
    const english = generateVacancyPitch({ vacancy: leidos, facts: outcome('Worked on logistics as the team grew from 8 to 35.') }).emailPitch.body;
    expect(english).toContain('Among my results: worked on logistics as the team grew from 8 to 35.');
  });

  it('a name or an acronym keeps its capital after the colon', () => {
    for (const statement of ['Kubernetes-кластер на 40 команд обслуживал весь банк.', 'CRM внедрена в 12 филиалах.', 'Вектор Банк вырос на 30%.']) {
      const body = generateVacancyPitch({ vacancy: vector, facts: outcome(statement) }).emailPitch.body;
      expect(body).toContain(`Из результатов: ${statement}`);
    }
  });

  it('the English letter says at Leidos, not at the Leidos team', () => {
    const body = generateVacancyPitch({ vacancy: leidos, facts: [] }).emailPitch.body;
    expect(body).toContain("I'm interested in the Director, Technology Operations role at Leidos.");
    expect(generateVacancyPitch({ vacancy: { id: 'v', title: 'Director', description: 'Lead' }, facts: [] }).emailPitch.body)
      .toContain("I'm interested in the Director role on your team.");
  });

  it('employers typed in quotes lose them in the English letter', () => {
    const places = [{ employer: '«Финтех Лаб»', title: 'Head of Engineering', startDate: '2024-01', endDate: null, current: true, evidenceIds: ['a'] }];
    expect(generateVacancyPitch({ vacancy: leidos, facts: [], workplaces: places }).emailPitch.body).toContain('at Финтех Лаб (2024');
  });
});

describe('resultFirst: a dependent tail stays behind its subject (05.11)', () => {
  it('keeps the order of an English fact with a participle tail', () => {
    const fact = 'Warehouse and logistics for a nationwide retail chain, with the team growing from 8 to 35 people';
    expect(resultFirst(fact, 'en')).toBe(fact);
  });

  it('keeps other dependent tails in place', () => {
    for (const fact of ['Warehouse for a chain, growing the team from 8 to 35', 'Warehouse for a chain, which cut delivery to 7 days', 'Склад для сети, что сократило срок до 7 дней']) {
      expect(resultFirst(fact, 'en')).toBe(fact);
    }
  });

  it('still moves an independent result forward', () => {
    expect(resultFirst('Склад и логистика для сети, команда выросла с 8 до 35 человек', 'ru')).toBe('команда выросла с 8 до 35 человек — склад и логистика для сети');
  });
});

describe('letterFactsToTranslate: an English letter from a Russian profile', () => {
  const fact = (id: string, statement: string) => ({ id, statement, domain: 'outcome' });
  const facts = [fact('rec', 'Руководитель, 2014'), fact('a', 'Срок сократился с 12 до 7 дней'), fact('b', 'Единая система KPI для пяти направлений'), fact('c', 'Already in English 5')];
  const places = [{ recordId: 'rec', evidenceIds: ['rec', 'a'] }];

  it('translates only workplace results: the model writes in the letter language itself', () => {
    expect(letterFactsToTranslate(facts, places, 'en').map((item) => item.id)).toEqual(['a']);
  });

  it('a Russian letter translates nothing', () => {
    expect(letterFactsToTranslate(facts, places, 'ru')).toEqual([]);
  });
});
