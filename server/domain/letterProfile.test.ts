import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './resumeDraft';
import { letterProfileText, MAX_LETTER_PROFILE_CHARS } from './letterProfile';
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
    const text = letterProfileText({ draft, facts, includedWorkplaceIds: ['w1', 'w2'] });
    for (const part of ['VP of Technology', 'Строю ИТ-организации.', 'Дубай',
      '## Директор | Россети Цифра | Москва | 2023-04 — 2025-10', '- Выручка выросла с 230 млн до 2 млрд рублей',
      '## Советник | OptiLab | 2025-11 — now', '- Спроектировал LLM Gateway',
      'eterapy.com', 'ТУМ', 'English C1', 'Python, ITIL']) {
      expect(text).toContain(part);
    }
  });

  it('факт вне мест работы идёт уточнением кандидата: так письмо узнаёт настоящие названия', () => {
    const text = letterProfileText({ draft, facts, includedWorkplaceIds: ['w1', 'w2'] });
    expect(text).toContain('УТОЧНЕНИЯ КАНДИДАТА');
    expect(text).toContain('- «Enterprise Public Cloud Platform» — это VK Cloud');
    // Запись о самом месте работы и его пункты не дублируются в уточнениях.
    expect(text.match(/Спроектировал LLM Gateway/gu)).toHaveLength(1);
    expect(text).not.toContain('Директор в Россети Цифра');
  });

  it('контакты, имя кандидата и чужие рекомендации модели не уходят', () => {
    const text = letterProfileText({ draft, facts, includedWorkplaceIds: ['w1', 'w2'] });
    for (const part of ['ivan@example.com', '+70000000000', 'Иван Петров', 'Чужой Человек', 'Отличный коллега']) {
      expect(text).not.toContain(part);
    }
  });

  it('место работы, которое кандидат снял с письма, не попадает в профиль вместе с пунктами', () => {
    const text = letterProfileText({ draft, facts: facts.filter((item) => item.id !== 'b3'), includedWorkplaceIds: ['w1'] });
    expect(text).not.toContain('Советник');
    expect(text).not.toContain('Спроектировал LLM Gateway');
  });

  it('пункт, не прошедший фильтр фактов письма, в профиль не идёт', () => {
    const negative = fact('b2', 'Я не работал с большими командами');
    const text = letterProfileText({
      draft,
      facts: [...facts.filter((item) => item.id !== 'b2'), negative],
      includedWorkplaceIds: ['w1', 'w2'],
    });
    expect(text).not.toContain('Я не работал с большими командами');
    expect(text).not.toContain('Команда 250+ человек');
  });

  it('подтверждённое уточнение идёт раньше импортированного, а запись места работы не считается уточнением', () => {
    const text = letterProfileText({
      draft,
      facts: [...facts, { ...fact('imp0123456789-a', 'Импортированный факт', 'proposed') }, fact('note2', 'Работаю с Python каждый день')],
      includedWorkplaceIds: ['w1', 'w2'],
    });
    expect(text.indexOf('Работаю с Python каждый день')).toBeLessThan(text.indexOf('Импортированный факт'));
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
      draft: withEvidence, facts, includedWorkplaceIds: ['w1', 'w2'], withheldEvidenceIds: new Set(['secret']),
    });
    expect(text).not.toMatch(/Тайн|Закрытая история/u);
    expect(text).toContain('Открытый проект');
  });

  it('проект снятого места работы не уходит, а проект оставшегося места уходит', () => {
    const withProjects: ResumeDraft = {
      ...draft,
      projects: [
        { id: 'p1', name: 'Проект энергетиков', employer: 'россети цифра' },
        { id: 'p2', name: 'eterapy.com', employer: 'OptiLab' },
      ],
    };
    const text = letterProfileText({ draft: withProjects, facts, includedWorkplaceIds: ['w2'] });
    expect(text).not.toContain('Проект энергетиков');
    expect(text).toContain('eterapy.com');
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
    const text = letterProfileText({ draft: withContacts, facts: noted, includedWorkplaceIds: ['w1', 'w2'] });
    expect(text).not.toMatch(/example\.com|916|ivan_petrov|linkedin\.com/u);
    expect(text).toContain('eterapy.com');
    expect(text).toContain('+40%');
    expect(text).toContain('1 200 000 000 рублей');
  });

  it('размер ограничен, но опыт важнее хвоста уточнений', () => {
    const many = Array.from({ length: 2000 }, (_, index) => fact(`n${index}`, `Уточнение ${index} ${'с'.repeat(80)}`));
    const text = letterProfileText({ draft, facts: [...facts, ...many], includedWorkplaceIds: ['w1', 'w2'] });
    expect(text.length).toBeLessThanOrEqual(MAX_LETTER_PROFILE_CHARS);
    expect(text).toContain('Спроектировал LLM Gateway');
  });

  it('пустой черновик без фактов даёт пустой профиль: спрашивать модель не о чем', () => {
    expect(letterProfileText({ draft: EMPTY_RESUME_DRAFT, facts: [], includedWorkplaceIds: [] })).toBe('');
  });
});
