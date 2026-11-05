import { describe, expect, it } from 'vitest';
import { checkGeneratedTextFacts } from './generatedTextFactGate';
import { resultFirst } from './letterResults';
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

describe('resultFirst: one readable phrase from the same facts (05.11)', () => {
  it('names a shared subject once and adds no action of the candidate', () => {
    expect(resultFirst('Отдел продаж упаковки для пищевых производств, отдел вырос с 6 до 22 менеджеров.', 'ru'))
      .toBe('Отдел продаж упаковки для пищевых производств вырос с 6 до 22 менеджеров');
    expect(resultFirst('Department of packaging sales, the department grew from 6 to 22 managers', 'en'))
      .toBe('Department of packaging sales grew from 6 to 22 managers');
  });

  it('keeps a different subject as it was', () => {
    expect(resultFirst('Склад и логистика для сети, команда выросла с 8 до 35 человек', 'ru')).toBe('команда выросла с 8 до 35 человек — склад и логистика для сети');
  });

  it('keeps a dependent tail behind its subject', () => {
    const fact = 'Warehouse and logistics for a nationwide retail chain, with the team growing from 8 to 35 people';
    expect(resultFirst(fact, 'en')).toBe(fact);
    for (const other of ['Warehouse for a chain, growing the team from 8 to 35', 'Warehouse for a chain, which cut delivery to 7 days']) {
      expect(resultFirst(other, 'en')).toBe(other);
    }
  });
});

describe('the template letter does not depend on the candidate\'s gender (05.11)', () => {
  const place = (employer: string, title: string, startDate: string, endDate: string | null, evidenceIds: string[]) => ({
    employer, title, startDate, endDate, current: endDate === null, recordId: employer, evidenceIds: [employer, ...evidenceIds],
  });
  const fact = (id: string, statement: string, domain = 'outcome'): VacancyPitchInputFact => ({
    id, statement, kind: 'fact', domain, sourceMessageIds: ['m'], status: 'confirmed',
  } as unknown as VacancyPitchInputFact);
  const profiles = [
    {
      name: 'Алексей Иванов',
      vacancy: { id: 'it', title: 'Руководитель разработки/Head of Engineering', company: 'Телеком-Сервис', description: 'Платформа для ЖКХ.', requiredSkills: [] },
      facts: [fact('it', 'Склад и логистика для федеральной сети магазинов, команда выросла с 8 до 35 человек.')],
      workplaces: [place('Финтех Лаб', 'Head of Engineering', '2024-01', null, []), place('Ритейл Системс', 'Руководитель разработки', '2014-01', '2021-12', ['it'])],
      results: ['команда выросла с 8 до 35 человек', 'склад и логистика для федеральной сети магазинов'],
    },
    {
      name: 'Марина Соколова',
      vacancy: { id: 'sales', title: 'Руководитель отдела продаж', company: 'АГМ Партс', description: 'Запасные части для сельхозтехники.', requiredSkills: [] },
      facts: [fact('sales', 'Отдел продаж упаковки для пищевых производств, отдел вырос с 6 до 22 менеджеров.')],
      workplaces: [place('УралПак', 'Директор по продажам', '2020-03', null, ['sales'])],
      results: ['Из результатов: отдел продаж упаковки для пищевых производств вырос с 6 до 22 менеджеров.'],
    },
  ];

  for (const profile of profiles) {
    it(`${profile.name}: no gendered phrase in any tone or text, no fact lost`, () => {
      for (const tone of ['executive', 'confident', 'technical'] as const) {
        const pitch = generateVacancyPitch({ vacancy: profile.vacancy, candidateName: profile.name, facts: profile.facts, tone, language: 'ru', workplaces: profile.workplaces });
        const texts = [pitch.emailPitch.body, pitch.atsCoverLetter, pitch.linkedInNote, pitch.contactMessage];
        for (const text of texts) expect(text).not.toMatch(/(?:буду рад|готов обсудить|рад знакомству)/iu);
        // Our own wording asks the candidate to confirm nothing.
        const asked = texts.flatMap((text) => checkGeneratedTextFacts(text, profile.facts).claims).filter((claim) => claim.action === 'ask_candidate');
        expect(asked.filter((claim) => /(?:хочу|предлагаю|направляю)/iu.test(claim.text))).toEqual([]);
        for (const result of profile.results) expect(pitch.emailPitch.body).toContain(result);
        expect(pitch.emailPitch.body).toContain(profile.workplaces[0]?.employer);
      }
    });
  }

  it('the executive wording is the agreed one', () => {
    const { emailPitch } = generateVacancyPitch({ vacancy: profiles[1]!.vacancy, candidateName: 'Марина Соколова', facts: profiles[1]!.facts, language: 'ru', workplaces: profiles[1]!.workplaces });
    expect(emailPitch.body).toContain('Хочу узнать больше о целях и приоритетах роли.');
    expect(emailPitch.body).toContain('Предлагаю обсудить цели роли и приоритеты бизнеса на коротком звонке.');
  });

  it('the English letter signs in Latin and keeps its wording', () => {
    const pitch = generateVacancyPitch({ vacancy: { id: 'en', title: 'Director, IT Operations', company: 'HealthEdge', description: 'Service management.', requiredSkills: [] }, candidateName: 'Алексей Иванов', facts: [], language: 'en', workplaces: profiles[0]!.workplaces });
    expect(pitch.atsCoverLetter).toContain('Aleksey Ivanov');
    expect(pitch.atsCoverLetter).not.toContain('Алексей');
    expect(pitch.emailPitch.body).toContain("I'd be glad to learn more about the role's goals and priorities.");
  });
});
