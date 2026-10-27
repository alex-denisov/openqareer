import { describe, expect, it } from 'vitest';
import { WORK_PREFERENCE_KEY_VERSION, type WorkPreferenceResult } from './workPreferences';
import type { RoleObservation } from './poolRoleHypotheses';
import { proposeRoles, type NamedRole } from './roleProposals';

function vacancy(title: string, skills: string[] = ['SQL'], source = 'hh'): RoleObservation {
  return {
    canonicalTitle: title,
    firstObservedAt: '2026-08-20T08:00:00.000Z',
    skills,
    sources: [{ sourceType: source }],
  };
}

function named(title: string, reason = 'девять лет вёл внутренние продукты'): NamedRole {
  return { title, reason, evidenceRefs: ['document:resume'] };
}

describe('proposeRoles', () => {
  it('оставляет названную моделью роль, которой нет в пуле, вместо отказа', () => {
    const roles = proposeRoles({
      named: [named('Head of Growth')],
      pool: [],
      candidateSkills: [],
    });

    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      title: 'Head of Growth',
      origin: 'model',
      confirmation: { state: 'not-found' },
    });
  });

  it('показывает абсолютное число и не агрегирует требования, когда наблюдений меньше восьми', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: Array.from({ length: 7 }, () => vacancy('Продакт-менеджер')),
      candidateSkills: [],
    });

    expect(roles[0].confirmation).toEqual({ state: 'too-few', sampleSize: 7 });
  });

  it('подтверждает роль числами, когда наблюдений хватает', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: Array.from({ length: 9 }, () => vacancy('Продакт-менеджер', ['SQL', 'discovery'])),
      candidateSkills: ['SQL'],
    });

    expect(roles[0].confirmation).toMatchObject({
      state: 'observed',
      sampleSize: 9,
      sources: [{ source: 'hh', count: 9 }],
      matchedRequirements: 1,
    });
  });

  it('склеивает имя модели и имя рынка в одну строку', () => {
    const roles = proposeRoles({
      named: [named('Product Manager')],
      pool: Array.from({ length: 9 }, () => vacancy('Продакт-менеджер')),
      candidateSkills: [],
    });

    expect(roles).toHaveLength(1);
    expect(roles[0].origin).toBe('model');
    expect(roles[0].confirmation).toMatchObject({ state: 'observed', sampleSize: 9 });
  });

  it('добавляет роль, которую назвал рынок, а модель не назвала', () => {
    const roles = proposeRoles({
      named: [named('Head of Growth')],
      pool: Array.from({ length: 9 }, () => vacancy('Аналитик данных')),
      candidateSkills: [],
    });

    expect(roles.map((role) => role.origin)).toEqual(['market', 'model']);
    expect(roles[0].title).toBe('Аналитик данных');
    expect(roles[0].reason).toBeNull();
  });

  it('отбрасывает роль, которую модель не объяснила фактом резюме', () => {
    const roles = proposeRoles({
      named: [{ title: 'Космонавт', reason: '', evidenceRefs: [] }],
      pool: [],
      candidateSkills: [],
    });

    expect(roles).toEqual([]);
  });

  it('не даёт модели задавать порядок: перестановка входа не меняет выход', () => {
    const pool = [
      ...Array.from({ length: 9 }, () => vacancy('Аналитик данных')),
      ...Array.from({ length: 12 }, () => vacancy('Продакт-менеджер')),
    ];
    const first = proposeRoles({
      named: [named('Аналитик данных'), named('Продакт-менеджер'), named('Head of Growth')],
      pool,
      candidateSkills: [],
    });
    const second = proposeRoles({
      named: [named('Head of Growth'), named('Продакт-менеджер'), named('Аналитик данных')],
      pool,
      candidateSkills: [],
    });

    expect(second).toEqual(first);
    expect(first.map((role) => role.title)).toEqual([
      'Продакт-менеджер',
      'Аналитик данных',
      'Head of Growth',
    ]);
  });
});

describe('proposeRoles: что считается одной ролью', () => {
  it('грейд и формат не расщепляют роль', () => {
    const roles = proposeRoles({
      named: [named('Продакт-менеджер')],
      pool: [
        ...Array.from({ length: 5 }, () => vacancy('Senior Product Manager')),
        ...Array.from({ length: 4 }, () => vacancy('Ведущий продакт-менеджер (удалённо)')),
      ],
      candidateSkills: [],
    });

    expect(roles[0].confirmation).toMatchObject({ state: 'observed', sampleSize: 9 });
  });

  it('разные роли не сливаются в одну', () => {
    const roles = proposeRoles({
      named: [named('Менеджер по продукту'), named('Менеджер по закупкам')],
      pool: [
        ...Array.from({ length: 9 }, () => vacancy('Менеджер по продукту')),
        ...Array.from({ length: 9 }, () => vacancy('Менеджер по закупкам')),
      ],
      candidateSkills: [],
    });

    expect(roles.map((role) => sample(role))).toEqual([9, 9]);
  });
});

function sample(role: { confirmation: { state: string; sampleSize?: number } }): number {
  return role.confirmation.sampleSize ?? 0;
}

describe('порядок ролей после заданий «Какие роли мне подходят» (B180 срез 3)', () => {
  const named = [
    { title: 'Operations Manager', reason: 'вёл операции', evidenceRefs: ['memory:1'] },
    { title: 'Data Analyst', reason: 'считал когорты', evidenceRefs: ['memory:2'] },
    { title: 'Product Manager', reason: 'вёл продукты', evidenceRefs: ['memory:3'] },
  ];

  const preferring = (family: 'ПП' | 'РР'): WorkPreferenceResult => ({
    keyVersion: WORK_PREFERENCE_KEY_VERSION,
    answered: 12,
    counts: [],
    excluded: [],
    discriminates: true,
    ranked: [{ family, name: 'верх', value: 3, total: 3, basis: 'выбрали 3 раза из 3' }],
  });

  it('ответы меняют порядок ролей одного яруса, но не состав', () => {
    const flow = proposeRoles({
      named,
      pool: [],
      candidateSkills: [],
      preferences: preferring('ПП'),
    });
    const numbers = proposeRoles({
      named,
      pool: [],
      candidateSkills: [],
      preferences: preferring('РР'),
    });

    expect(flow[0].title).toBe('Operations Manager');
    expect(numbers[0].title).toBe('Data Analyst');
    // Состав тот же: задания уточняют порядок гипотез, а не находят роли.
    expect(flow.map((role) => role.title).sort()).toEqual(numbers.map((role) => role.title).sort());
  });

  it('отказ различить оставляет порядок доказательству', () => {
    const undecided: WorkPreferenceResult = {
      ...preferring('ПП'),
      discriminates: false,
      ranked: [],
    };

    expect(
      proposeRoles({ named, pool: [], candidateSkills: [], preferences: undecided }).map(
        (role) => role.title,
      ),
    ).toEqual(proposeRoles({ named, pool: [], candidateSkills: [] }).map((role) => role.title));
  });

  it('исключённый вид работы уходит в конец яруса, но роль с экрана не убирает', () => {
    const excluded: WorkPreferenceResult = {
      ...preferring('РР'),
      excluded: ['ПП'],
    };

    const roles = proposeRoles({
      named,
      pool: [],
      candidateSkills: [],
      preferences: excluded,
    });

    expect(roles.map((role) => role.title)).toContain('Operations Manager');
    expect(roles[roles.length - 1].title).toBe('Operations Manager');
  });
});

describe('вилка роли по вакансиям с зарплатой (B445)', () => {
  function paid(
    from: number | undefined,
    to: number | undefined,
    currency = 'RUR',
  ): RoleObservation {
    return { ...vacancy('Director of Engineering'), salary: { from, to, currency } };
  }

  it('считает вилку только по рублёвым вакансиям с зарплатой и отдаёт их число', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => paid(500_000 + i * 10_000, 700_000 + i * 10_000)),
      paid(9_000, 12_000, 'USD'),
      vacancy('Director of Engineering'),
    ];
    const [role] = proposeRoles({
      named: [named('Director of Engineering')],
      pool,
      candidateSkills: [],
    });
    expect(role.confirmation.state).toBe('observed');
    if (role.confirmation.state !== 'observed') return;
    expect(role.confirmation.sampleSize).toBe(12);
    expect(role.confirmation.wage).toEqual({ sampleSize: 10, min: 520_000, max: 770_000 });
  });

  it('без вакансий с зарплатой вилки нет', () => {
    const pool = Array.from({ length: 9 }, () => vacancy('Director of Engineering'));
    const [role] = proposeRoles({
      named: [named('Director of Engineering')],
      pool,
      candidateSkills: [],
    });
    if (role.confirmation.state !== 'observed') throw new Error('expected observed');
    expect(role.confirmation.wage).toEqual({ sampleSize: 0 });
  });
});

describe('какие требования роли подтверждены навыками (B445)', () => {
  it('называет совпавшие требования, а не только их число', () => {
    const pool = Array.from({ length: 9 }, () => vacancy('CTO', ['Kafka', 'Go', 'SQL']));
    const [role] = proposeRoles({ named: [named('CTO')], pool, candidateSkills: ['go'] });
    if (role.confirmation.state !== 'observed') throw new Error('expected observed');
    expect(role.confirmation.matchedRequirementNames).toEqual(['Go']);
  });
});

describe('proposeRoles: одна роль под разными названиями (26.10)', () => {
  // Ключ функции и уровня приходит с сервера; здесь — таблица из теста.
  const KEYS: Record<string, string> = {
    'Технический директор': 'eng-mgmt.cto',
    'Технический директор (CTO)': 'eng-mgmt.cto',
    'Операционный директор (COO)': 'ops.coo',
    'Chief Operating Officer': 'ops.coo',
    'Операционный директор': 'ops.coo',
  };
  const roleKey = (title: string) => KEYS[title] ?? null;
  const many = (title: string, count: number) =>
    Array.from({ length: count }, () => vacancy(title));

  it('сводит названия одной функции и уровня в одну строку без потери вакансий', () => {
    const roles = proposeRoles({
      named: [],
      pool: [
        ...many('Операционный директор (COO)', 106),
        ...many('Операционный директор', 46),
        ...many('Chief Operating Officer', 45),
        ...many('Технический директор', 69),
        ...many('Технический директор (CTO)', 24),
      ],
      candidateSkills: [],
      roleKey,
    });

    expect(roles.map((role) => [role.title, sampleOf(role)])).toEqual([
      ['Операционный директор (COO)', 197],
      ['Технический директор', 93],
    ]);
    expect(roles[0]?.aliases).toEqual([
      'Операционный директор (COO)',
      'Операционный директор',
      'Chief Operating Officer',
    ]);
  });

  it('роль модели забирает вакансии своей функции и уровня под любым названием', () => {
    const roles = proposeRoles({
      named: [named('Chief Operating Officer')],
      pool: [...many('Операционный директор', 10), ...many('Операционный директор (COO)', 5)],
      candidateSkills: [],
      roleKey,
    });

    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ title: 'Chief Operating Officer', origin: 'model' });
    expect(sampleOf(roles[0]!)).toBe(15);
  });

  it('не срезает роли, подтверждённые опытом, ради ролей рынка', () => {
    const modelTitles = [
      'Head of AI',
      'Head of Support',
      'Customer Support Director',
      'VP of Customer Support',
    ];
    const roles = proposeRoles({
      named: modelTitles.map((title) => named(title)),
      pool: ['Analyst', 'Designer', 'Recruiter', 'Accountant', 'Lawyer', 'Teacher'].flatMap(
        (title) => many(title, 20),
      ),
      candidateSkills: [],
    });

    expect(
      roles
        .filter((role) => role.origin === 'model')
        .map((role) => role.title)
        .sort(),
    ).toEqual([...modelTitles].sort());
    expect(roles.filter((role) => role.origin === 'market')).toHaveLength(5);
  });
});

function sampleOf(role: { confirmation: { state: string; sampleSize?: number } }): number {
  return role.confirmation.sampleSize ?? 0;
}

describe('proposeRoles: имя роли рынка (27.10)', () => {
  it('называет роль одним названием, а не склейкой двух должностей через «/»', () => {
    const joined = 'Производственный директор / Технический директор';
    const roles = proposeRoles({
      named: [],
      pool: [
        ...Array.from({ length: 6 }, () => vacancy(joined)),
        ...Array.from({ length: 4 }, () => vacancy('Производственный директор')),
      ],
      candidateSkills: [],
      roleKey: () => 'manufacturing:top',
    });
    expect(roles[0]?.title).toBe('Производственный директор');
  });
});

describe('proposeRoles: короткое имя при равной частоте (27.10)', () => {
  it('из названий, встретившихся одинаково часто, берёт самое короткое', () => {
    const titles = [
      'Director of Applied Science and Engineering - Knowledge Graphs & AI',
      'AI Director',
      'AI Transformation Director',
      'Associate Vice President, Model & AI Governance',
      'AI Engineering Sr Director',
      'Chief AI Officer',
      'VP of AI',
      'Director of AI Platform',
    ];
    const roles = proposeRoles({
      named: [],
      pool: titles.map((title) => vacancy(title)),
      candidateSkills: [],
      roleKey: () => 'ai-ml:top',
    });
    expect(roles[0]?.title).toBe('VP of AI');
  });
});

describe('proposeRoles: описание вакансии — не имя роли (27.10)', () => {
  it('короткое название побеждает длинное, даже встретившееся чаще', () => {
    const long = 'Director of Applied Science and Engineering - Knowledge Graphs & AI';
    const roles = proposeRoles({
      named: [],
      pool: [
        ...Array.from({ length: 2 }, () => vacancy(long)),
        ...[
          'AI Director',
          'Director, AI Platforms',
          'VP of AI Engineering',
          'Chief AI Officer',
        ].flatMap((title) => [vacancy(title)]),
        ...Array.from({ length: 2 }, () => vacancy('Director of AI')),
      ],
      candidateSkills: [],
      roleKey: () => 'ai-ml:top',
    });
    expect(roles[0]?.title).toBe('Director of AI');
  });
});

describe('proposeRoles: одно слово без функции — не роль (27.10)', () => {
  it('«Директор» не предлагается ролью рынка', () => {
    const roles = proposeRoles({
      named: [],
      pool: Array.from({ length: 12 }, () => vacancy('Директор')),
      candidateSkills: [],
    });
    expect(roles).toEqual([]);
  });
});

describe('повторяющиеся требования большой роли (28.10)', () => {
  it('находит требования, когда навыки есть не у каждой вакансии', () => {
    // 266 вакансий «Технического директора»: навыки разные, и порог «у половины всех»
    // не набирал ни одного требования — экран писал «совпадений нет».
    const pool = [
      ...Array.from({ length: 30 }, () => vacancy('CTO', ['Kubernetes', 'Архитектура'])),
      ...Array.from({ length: 30 }, () => vacancy('CTO', ['Архитектура'])),
      ...Array.from({ length: 60 }, (_, index) => vacancy('CTO', [`Навык ${index}`])),
      ...Array.from({ length: 40 }, () => vacancy('CTO', [])),
    ];
    const roles = proposeRoles({ named: [], pool, candidateSkills: ['архитектура'] });
    const confirmation = roles[0].confirmation;

    expect(confirmation.state === 'observed' && confirmation.repeatedRequirements).toEqual([
      'Архитектура',
      'Kubernetes',
    ]);
    expect(confirmation.state === 'observed' && confirmation.matchedRequirementNames).toEqual([
      'Архитектура',
    ]);
  });
});
