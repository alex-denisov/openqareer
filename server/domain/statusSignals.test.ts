import { describe, expect, it } from 'vitest';
import {
  detectStatusSignal,
  signalSilentUntil,
  SILENT_FOREVER,
  type SignalAnswerRecord,
  type SignalApplication,
  type SignalInput,
} from './statusSignals';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number, hours = 0): string =>
  new Date(NOW.getTime() - days * DAY - hours * 3_600_000).toISOString();

let counter = 0;
function application(overrides: Partial<SignalApplication>): SignalApplication {
  counter += 1;
  return {
    id: `a${counter}`,
    vacancyKey: `v${counter}`,
    functionCode: 'engineering',
    stage: 'applied',
    createdAt: ago(1),
    appliedAt: ago(1),
    stageChangedAt: ago(1),
    automatic: false,
    ...overrides,
  };
}

function input(overrides: Partial<SignalInput>): SignalInput {
  return {
    now: NOW,
    timezone: 'Europe/Moscow',
    status: 'looking',
    statusSince: null,
    applications: [],
    roleFamilySkips: [],
    targetFunctions: ['engineering'],
    functionLabels: { product: 'Управление продуктом', engineering: 'Разработка' },
    answers: [],
    ...overrides,
  };
}

const saved = (days: number, functionCode = 'product'): SignalApplication =>
  application({
    stage: 'saved',
    functionCode,
    createdAt: ago(days),
    appliedAt: null,
    stageChangedAt: ago(days),
  });

describe('сигнал «похоже, вы начали искать работу»', () => {
  const three = [
    application({}),
    application({ appliedAt: ago(2) }),
    application({ appliedAt: ago(6) }),
  ];

  it('появляется при «Присматриваюсь» после двух своих откликов на разные вакансии за неделю', () => {
    const signal = detectStatusSignal(input({ applications: three }));
    expect(signal).toMatchObject({
      kind: 'started_search',
      question: { before: 'Похоже, вы ', accent: 'начали искать работу', after: '. Верно?' },
      suggest: { status: 'job_search', targetProfession: null },
    });
    expect(signal?.facts).toEqual([
      '3 отклика за неделю, раньше 0',
      'Отправили сами, не автооткликами',
    ]);
  });

  it('называет, сколько откликов было за месяц до этого', () => {
    const earlier = application({ appliedAt: ago(20) });
    const signal = detectStatusSignal(input({ applications: [...three, earlier] }));
    expect(signal?.facts[0]).toBe('3 отклика за неделю, раньше 1');
  });

  it('автоотклики не считает и про «сами» при них не говорит', () => {
    const auto = [application({ automatic: true }), application({ automatic: true })];
    expect(detectStatusSignal(input({ applications: auto }))).toBeNull();
    const mixed = detectStatusSignal(input({ applications: [...three, ...auto] }));
    expect(mixed?.facts).toEqual(['3 отклика за неделю, раньше 0']);
  });

  it('молчит: один отклик, два отклика на одну вакансию, отклики старше недели', () => {
    expect(detectStatusSignal(input({ applications: [application({})] }))).toBeNull();
    const same = [application({ vacancyKey: 'same' }), application({ vacancyKey: 'same' })];
    expect(detectStatusSignal(input({ applications: same }))).toBeNull();
    const old = [application({ appliedAt: ago(8) }), application({ appliedAt: ago(9) })];
    expect(detectStatusSignal(input({ applications: old }))).toBeNull();
  });

  it('отклик, уже ушедший в архив, остаётся откликом', () => {
    const archived = three.map((item) => ({ ...item, stage: 'archived' }));
    expect(detectStatusSignal(input({ applications: archived }))?.kind).toBe('started_search');
  });

  it('молчит при любом статусе, кроме «Присматриваюсь»', () => {
    for (const status of [
      'job_search',
      'choosing_role',
      'changing_profession',
      'working',
    ] as const) {
      expect(detectStatusSignal(input({ status, applications: three }))?.kind).not.toBe(
        'started_search',
      );
    }
  });

  it('молчит 14 дней после смены статуса', () => {
    expect(detectStatusSignal(input({ applications: three, statusSince: ago(13) }))).toBeNull();
    expect(detectStatusSignal(input({ applications: three, statusSince: ago(15) }))).not.toBeNull();
  });
});

describe('сигнал «хотите сменить профессию»', () => {
  const saves = [saved(1), saved(3), saved(3), saved(9)];

  it('появляется после четырёх сохранений чужого направления в три разных дня', () => {
    const signal = detectStatusSignal(input({ status: 'job_search', applications: saves }));
    expect(signal).toMatchObject({
      kind: 'changing_profession',
      question: {
        before: 'Смотрите вакансии по направлению ',
        accent: 'Управление продуктом',
        after: '. Хотите сменить профессию?',
      },
      suggest: { status: 'changing_profession', targetProfession: 'Управление продуктом' },
    });
    expect(signal?.facts).toEqual(['За 3 недели сохранили 4 вакансии этого направления']);
  });

  it('добавляет факты про отклики и пропуски «не та роль», не больше трёх', () => {
    const applied = [
      application({ functionCode: 'product', appliedAt: ago(2) }),
      application({ functionCode: 'product', appliedAt: ago(4) }),
    ];
    const signal = detectStatusSignal(
      input({
        status: 'job_search',
        applications: [...saves, ...applied],
        roleFamilySkips: [ago(1), ago(5), ago(30)],
      }),
    );
    expect(signal?.facts).toEqual([
      'За 3 недели сохранили 6 вакансий этого направления',
      'Откликнулись на 2 из них',
      'Пропустили 2 вакансии с причиной «не та роль»',
    ]);
  });

  it('хватает двух своих откликов в чужом направлении', () => {
    const applied = [
      application({ functionCode: 'product', createdAt: ago(2), appliedAt: ago(2) }),
      application({ functionCode: 'product', createdAt: ago(4), appliedAt: ago(4) }),
    ];
    const signal = detectStatusSignal(input({ status: 'job_search', applications: applied }));
    expect(signal?.kind).toBe('changing_profession');
  });

  it('молчит: своё направление, три сохранения, два дня, доля ниже 40 %, окно 21 день', () => {
    const run = (applications: SignalApplication[]) =>
      detectStatusSignal(input({ status: 'job_search', applications }));
    expect(
      run([
        saved(1, 'engineering'),
        saved(2, 'engineering'),
        saved(3, 'engineering'),
        saved(4, 'engineering'),
      ]),
    ).toBeNull();
    expect(run([saved(1), saved(3), saved(9)])).toBeNull();
    expect(run([saved(1), saved(1), saved(3), saved(3)])).toBeNull();
    const own = Array.from({ length: 7 }, (_, index) => saved(index + 1, 'engineering'));
    expect(run([...saves, ...own])).toBeNull();
    expect(run([saved(1), saved(3), saved(9), saved(22)])).toBeNull();
  });

  it('молчит без целевых ролей, без названия направления и при интервью или оффере за 14 дней', () => {
    const base = { status: 'job_search' as const, applications: saves };
    expect(detectStatusSignal(input({ ...base, targetFunctions: [] }))).toBeNull();
    expect(detectStatusSignal(input({ ...base, functionLabels: {} }))).toBeNull();
    const interview = application({
      stage: 'interview',
      stageChangedAt: ago(3),
      appliedAt: ago(30),
    });
    expect(detectStatusSignal(input({ ...base, applications: [...saves, interview] }))).toBeNull();
  });

  it('при «Присматриваюсь» идёт раньше сигнала про начало поиска', () => {
    const applied = [application({}), application({})];
    const signal = detectStatusSignal(input({ applications: [...saves, ...applied] }));
    expect(signal?.kind).toBe('changing_profession');
  });

  it('архивные вакансии не считает', () => {
    const archived = saves.map((item) => ({ ...item, stage: 'archived' as const }));
    expect(detectStatusSignal(input({ status: 'job_search', applications: archived }))).toBeNull();
  });
});

describe('память ответов', () => {
  const three = [application({}), application({}), application({})];
  const answer = (overrides: Partial<SignalAnswerRecord>): SignalAnswerRecord => ({
    kind: 'started_search',
    answer: 'no',
    createdAt: ago(1),
    ...overrides,
  });

  it('«Нет» выключает сигнал на 30 дней', () => {
    const silent = detectStatusSignal(
      input({ applications: three, answers: [answer({ createdAt: ago(29) })] }),
    );
    expect(silent).toBeNull();
    const back = detectStatusSignal(
      input({ applications: three, answers: [answer({ createdAt: ago(31) })] }),
    );
    expect(back?.kind).toBe('started_search');
  });

  it('второе «Нет» выключает сигнал насовсем', () => {
    const answers = [answer({ createdAt: ago(200) }), answer({ createdAt: ago(100) })];
    expect(signalSilentUntil(answers, 'started_search', 'UTC')).toBe(SILENT_FOREVER);
    expect(detectStatusSignal(input({ applications: three, answers }))).toBeNull();
  });

  it('«Нет» одному сигналу не глушит другой', () => {
    const saves = [saved(1), saved(3), saved(3), saved(9)];
    const signal = detectStatusSignal(
      input({ status: 'job_search', applications: saves, answers: [answer({})] }),
    );
    expect(signal?.kind).toBe('changing_profession');
  });

  it('«Не сейчас» молчит до конца дня кандидата', () => {
    const later = answer({ answer: 'later', createdAt: '2026-11-16T05:00:00.000Z' });
    expect(signalSilentUntil([later], 'started_search', 'Europe/Moscow')).toBe(
      '2026-11-16T21:00:00.000Z',
    );
    expect(detectStatusSignal(input({ applications: three, answers: [later] }))).toBeNull();
    const yesterday = answer({ answer: 'later', createdAt: ago(1) });
    expect(detectStatusSignal(input({ applications: three, answers: [yesterday] }))).not.toBeNull();
  });

  it('свежее «Не сейчас» не отменяет молчание после давнего «Нет»', () => {
    const answers = [
      answer({ createdAt: ago(10) }),
      answer({ answer: 'later', createdAt: ago(2) }),
    ];
    expect(detectStatusSignal(input({ applications: three, answers }))).toBeNull();
  });

  it('«Верно» молчит 14 дней: статус кандидат меняет сам', () => {
    const yes = answer({ answer: 'yes', createdAt: ago(13) });
    expect(detectStatusSignal(input({ applications: three, answers: [yes] }))).toBeNull();
    const old = answer({ answer: 'yes', createdAt: ago(15) });
    expect(detectStatusSignal(input({ applications: three, answers: [old] }))).not.toBeNull();
  });
});
