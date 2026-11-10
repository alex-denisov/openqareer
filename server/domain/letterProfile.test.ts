import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './resumeDraft';
import {
  letterNoteFacts,
  letterNotesToTranslate,
  letterProfileText,
  MAX_LETTER_PROFILE_CHARS,
} from './letterProfile';
import type { VacancyPitchInputFact } from './vacancyPitchService';

function fact(id: string, statement: string, status: VacancyPitchInputFact['status'] = 'confirmed'): VacancyPitchInputFact {
  return { id, statement, status, kind: 'fact', sourceMessageIds: ['m1'] };
}

const draft: ResumeDraft = {
  ...EMPTY_RESUME_DRAFT,
  candidate: {
    fullName: 'Иван Петров',
    headline: 'VP of Technology',
    about: 'Строю ИТ-организации.',
    contact: { email: 'ivan@example.com', phone: '+70000000000', location: 'Дубай' },
  },
  experience: [
    {
      id: 'w1', chronologyMemoryId: 'c1', title: 'Директор', employer: 'Россети Цифра', location: 'Москва',
      startDate: '2023-04', endDate: '2025-10', current: false, bulletMemoryIds: ['b1', 'b2'],
    },
    {
      id: 'w2', chronologyMemoryId: 'c2', title: 'Советник', employer: 'OptiLab',
      startDate: '2025-11', current: true, bulletMemoryIds: ['b3'],
    },
  ],
  projects: [{ id: 'p1', name: 'eterapy.com', description: 'SaaS-платформа', employer: 'OptiLab' }],
  education: [{ id: 'e1', evidenceMemoryId: 'x', institution: 'ТУМ', qualification: 'Инженер', endDate: '2010' }],
  languages: [{ id: 'l1', evidenceMemoryId: 'x', name: 'English', cefr: 'C1' }],
  skills: [{ id: 's1', name: 'Python' }, { id: 's2', name: 'ITIL' }],
  recommendations: [{ id: 'r1', recommender: 'Чужой Человек', text: 'Отличный коллега' }],
};

const facts = [
  fact('c1', 'Директор в Россети Цифра'),
  fact('b1', 'Выручка выросла с 230 млн до 2 млрд рублей'),
  fact('b2', 'Команда 250+ человек'),
  fact('b3', 'Спроектировал LLM Gateway'),
  fact('note', '«Enterprise Public Cloud Platform» — это VK Cloud'),
];

describe('letterProfileText: весь мастер-профиль для письма (B601)', () => {
  it('несёт заголовок, о себе, все места работы с пунктами, проекты, образование, языки, навыки', () => {
    const text = letterProfileText({ draft, facts });
    for (const part of ['VP of Technology', 'Строю ИТ-организации.', 'Дубай',
      '## Директор | Россети Цифра | Москва | 2023-04 — 2025-10', '- Выручка выросла с 230 млн до 2 млрд рублей',
      '## Советник | OptiLab | 2025-11 — now', '- Спроектировал LLM Gateway',
      'eterapy.com', 'ТУМ', 'English C1', 'Python, ITIL']) {
      expect(text).toContain(part);
    }
  });

  it('факт вне мест работы идёт уточнением кандидата: так письмо узнаёт настоящие названия', () => {
    const text = letterProfileText({ draft, facts });
    expect(text).toContain('УТОЧНЕНИЯ КАНДИДАТА');
    expect(text).toContain('- «Enterprise Public Cloud Platform» — это VK Cloud');
    // Запись о самом месте работы и его пункты не дублируются в уточнениях.
    expect(text.match(/Спроектировал LLM Gateway/gu)).toHaveLength(1);
    expect(text).not.toContain('Директор в Россети Цифра');
  });

  it('уточнения без места работы помечены: модель не приписывает их компании (B601, 10.11)', () => {
    const text = letterProfileText({ draft, facts });
    expect(text).toContain('УТОЧНЕНИЯ КАНДИДАТА К ПРОФИЛЮ (место работы у пунктов не указано');
  });

  it('обрывки реплик и оговорки «такого не было» в уточнения не идут, связные уточнения идут (B601, 10.11)', () => {
    const gap = { ...fact('g1', 'Цифра 80% по time-to-market была выдумана, и я не могу её обосновать.'), domain: 'gap' };
    const text = letterProfileText({
      draft,
      facts: [...facts, fact('f1', 'Стало семь'), fact('f2', 'Из семи сменились'), fact('f3', '-'), gap,
        fact('f4', 'Тикетов стало на 40% меньше.'), fact('f5', 'Команда 250+ человек.')],
    });
    for (const dropped of ['Стало семь', 'Из семи сменились', '- -', 'выдумана']) expect(text).not.toContain(dropped);
    expect(text).toContain('- Тикетов стало на 40% меньше.');
    expect(text).toContain('- Команда 250+ человек.');
    expect(text).toContain('- «Enterprise Public Cloud Platform» — это VK Cloud');
  });

  it('настоящее название работодателя стоит вместо маски, а факт о нём не дублируется уточнением (B639)', () => {
    const masked: ResumeDraft = {
      ...draft,
      experience: draft.experience.map((place) =>
        place.id === 'w1'
          ? {
              ...place,
              employer: 'Enterprise Energy IT Services',
              employerRealName: 'Россети Цифра',
              employerNameMemoryId: 'name',
            }
          : place,
      ),
    };
    const nameFact = {
      ...fact(
        'name',
        'Компания «Enterprise Energy IT Services» в профиле называется «Россети Цифра».',
      ),
      domain: 'other',
    };
    const text = letterProfileText({ draft: masked, facts: [...facts, nameFact] });
    expect(text).toContain('## Директор | Россети Цифра | Москва');
    expect(text).not.toContain('Enterprise Energy IT Services');
    expect(letterNoteFacts(masked, [...facts, nameFact]).map((item) => item.id)).toEqual(['note']);
  });

  it('работодатель места сменился: прежний ответ о маске не подставляется (B639)', () => {
    const changed: ResumeDraft = {
      ...draft,
      experience: draft.experience.map((place) =>
        place.id === 'w1'
          ? {
              ...place,
              employer: 'Газпром нефть',
              employerRealName: 'Россети Цифра',
              employerNameMemoryId: 'name',
            }
          : place,
      ),
    };
    const nameFact = {
      ...fact(
        'name',
        'Компания «Enterprise Energy IT Services» в профиле называется «Россети Цифра».',
      ),
      domain: 'other',
    };
    expect(letterProfileText({ draft: changed, facts: [...facts, nameFact] })).toContain(
      '## Директор | Газпром нефть | Москва',
    );
  });

  it('английскому письму переводят только русские уточнения, русскому ничего (B639)', () => {
    const notes = [
      ...facts,
      fact('ru', 'Работаю с Python каждый день'),
      fact('en', 'Built LLM Gateway in production'),
    ];
    expect(letterNotesToTranslate(draft, notes, 'en').map((item) => item.id)).toEqual([
      'note',
      'ru',
    ]);
    expect(letterNotesToTranslate(draft, notes, 'ru')).toEqual([]);
  });

  it('без подтверждённого факта о названии остаётся название из профиля (B639)', () => {
    const masked: ResumeDraft = {
      ...draft,
      experience: draft.experience.map((place) =>
        place.id === 'w1'
          ? {
              ...place,
              employer: 'Enterprise Energy IT Services',
              employerRealName: 'Россети Цифра',
              employerNameMemoryId: 'gone',
            }
          : place,
      ),
    };
    expect(letterProfileText({ draft: masked, facts })).toContain(
      '## Директор | Enterprise Energy IT Services | Москва',
    );
  });

  it('уточнение, повторяющее «о себе» или строку места работы, не дублируется (B601, 10.11)', () => {
    const text = letterProfileText({
      draft,
      facts: [...facts, fact('about-copy', 'Строю ИТ-организации.'), fact('record-copy', 'Директор, Россети Цифра · Москва')],
    });
    expect(text.match(/Строю ИТ-организации\./gu)).toHaveLength(1);
    expect(text).not.toContain('Директор, Россети Цифра · Москва');
    expect(text).toContain('- «Enterprise Public Cloud Platform» — это VK Cloud');
  });

  it('контакты, имя кандидата и чужие рекомендации модели не уходят', () => {
    const text = letterProfileText({ draft, facts });
    for (const part of ['ivan@example.com', '+70000000000', 'Иван Петров', 'Чужой Человек', 'Отличный коллега']) {
      expect(text).not.toContain(part);
    }
  });

  it('все места работы идут в профиль, и место без подтверждённых фактов тоже (B618)', () => {
    const text = letterProfileText({ draft, facts: facts.filter((item) => !['c2', 'b3'].includes(item.id)) });
    expect(text).toContain('## Советник | OptiLab | 2025-11 — now');
    expect(text).toContain('eterapy.com');
    expect(text).not.toContain('Спроектировал LLM Gateway');
  });

  it('пункт, не прошедший фильтр фактов письма, в профиль не идёт', () => {
    const negative = fact('b2', 'Я не работал с большими командами');
    const text = letterProfileText({
      draft,
      facts: [...facts.filter((item) => item.id !== 'b2'), negative],
    });
    expect(text).not.toContain('Я не работал с большими командами');
    expect(text).not.toContain('Команда 250+ человек');
  });

  it('подтверждённое уточнение идёт раньше импортированного, а запись места работы не считается уточнением', () => {
    const text = letterProfileText({
      draft,
      facts: [...facts, { ...fact('imp0123456789-a', 'Импортированный факт о работе с ITIL', 'proposed') }, fact('note2', 'Работаю с Python каждый день')],
    });
    expect(text.indexOf('Работаю с Python каждый день')).toBeLessThan(text.indexOf('Импортированный факт о работе с ITIL'));
  });

  it('снятое кандидатом и закрытое не уходит: о себе, проекты и остальное по своему факту', () => {
    const withEvidence: ResumeDraft = {
      ...draft,
      candidate: { ...draft.candidate, about: 'Закрытая история.', aboutMemoryId: 'secret' },
      projects: [
        { id: 'p1', evidenceMemoryId: 'secret', name: 'Тайный проект', description: 'Тайное описание' },
        { id: 'p2', name: 'Открытый проект' },
      ],
      achievements: [{ id: 'a1', kind: 'honor', evidenceMemoryId: 'secret', title: 'Тайная награда' }],
    };
    const text = letterProfileText({
      draft: withEvidence, facts, withheldEvidenceIds: new Set(['secret']),
    });
    expect(text).not.toMatch(/Тайн|Закрытая история/u);
    expect(text).toContain('Открытый проект');
  });

  it('контакты из свободного текста вычищаются, цифры опыта и адрес продукта остаются', () => {
    const withContacts: ResumeDraft = {
      ...draft,
      candidate: {
        ...draft.candidate,
        about: 'Пишите на ivan.p@example.com или +7 (916) 000-00-00, телеграм @ivan_petrov, t.me/ivan_petrov, 8 916 000 00 00.',
      },
    };
    const noted = [...facts, fact('n2', 'Запустил eterapy.com, рост +40% и 1 200 000 000 рублей, linkedin.com/in/ivan')];
    const text = letterProfileText({ draft: withContacts, facts: noted });
    expect(text).not.toMatch(/example\.com|916|ivan_petrov|linkedin\.com/u);
    expect(text).toContain('eterapy.com');
    expect(text).toContain('+40%');
    expect(text).toContain('1 200 000 000 рублей');
  });

  it('размер ограничен, но опыт важнее хвоста уточнений', () => {
    const many = Array.from({ length: 2000 }, (_, index) => fact(`n${index}`, `Уточнение ${index} ${'с'.repeat(80)}`));
    const text = letterProfileText({ draft, facts: [...facts, ...many] });
    expect(text.length).toBeLessThanOrEqual(MAX_LETTER_PROFILE_CHARS);
    expect(text).toContain('Спроектировал LLM Gateway');
  });

  it('пустой черновик без фактов даёт пустой профиль: спрашивать модель не о чем', () => {
    expect(letterProfileText({ draft: EMPTY_RESUME_DRAFT, facts: [] })).toBe('');
  });
});
