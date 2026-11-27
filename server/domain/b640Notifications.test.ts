import { describe, expect, it } from 'vitest';
import {
  searchRoleLabel,
  buildB640NotificationFeed,
  footprintTitle,
  type B640ApplicationContext,
  type B640NotificationSource,
} from './b640Notifications';
import { mergeDigestMarks, ROLE_DIGEST_SOURCE_TYPE } from './roleVacancyDigest';

const plain = (id: string) => ({ id, aboveFloor: false });

let counter = 0;
function source(overrides: Partial<B640NotificationSource> = {}): B640NotificationSource {
  counter += 1;
  return {
    id: `n-${counter}`,
    kind: 'employer_reply',
    sourceType: 'application',
    sourceId: 'app-1',
    createdAt: `2026-11-1${counter % 9}T10:00:00.000Z`,
    readAt: null,
    ...overrides,
  };
}

function application(overrides: Partial<B640ApplicationContext> = {}): B640ApplicationContext {
  return {
    stage: 'responded',
    company: 'Acme',
    role: 'Backend',
    interviewAt: null,
    failureNote: null,
    ...overrides,
  };
}

function feed(
  rows: B640NotificationSource[],
  apps: Record<string, B640ApplicationContext> = {},
  options: {
    category?: 'all' | 'invitations' | 'responses' | 'vacancies';
    offset?: number;
    limit?: number;
    searchRoles?: readonly string[];
  } = {},
) {
  return buildB640NotificationFeed({
    rows,
    applications: new Map(Object.entries(apps)),
    unreadCount: rows.filter((row) => row.readAt === null).length,
    category: options.category ?? 'all',
    offset: options.offset ?? 0,
    limit: options.limit ?? 20,
    searchRoles: options.searchRoles,
  });
}

describe('классификация уведомлений кабинета B640', () => {
  it('самый новый employer_reply отклика на стадии interview становится приглашением', () => {
    const newer = source({ id: 'new', createdAt: '2026-11-18T10:00:00.000Z' });
    const older = source({ id: 'old', createdAt: '2026-11-10T10:00:00.000Z' });
    const result = feed([newer, older], {
      'app-1': application({ stage: 'interview', interviewAt: '2026-11-25T09:00:00.000Z' }),
    });
    const all = [...result.pinned, ...result.items];
    expect(all.find((item) => item.id === 'new')).toMatchObject({
      kind: 'interview_invitation',
      category: 'invitations',
      important: true,
      title: 'Acme приглашает на интервью',
      company: 'Acme',
      role: 'Backend',
      eventAt: '2026-11-25T09:00:00.000Z',
    });
    expect(all.find((item) => item.id === 'old')?.kind).toBe('employer_reply');
  });

  it('стадия offer даёт оффер', () => {
    const result = feed([source({ id: 'o' })], { 'app-1': application({ stage: 'offer' }) });
    expect(result.pinned[0]).toMatchObject({
      kind: 'offer',
      title: 'Acme прислал оффер',
      eventAt: null,
    });
  });

  it('employer_reply на стадии responded остаётся ответом', () => {
    const result = feed([source({ id: 'r' })], { 'app-1': application() });
    expect(result.items[0]).toMatchObject({
      kind: 'employer_reply',
      category: 'responses',
      important: false,
      title: 'Acme ответил на отклик',
    });
  });

  it('delivery_error с причиной «нужен вход» становится platform_login_required', () => {
    const rows = [source({ id: 'd', kind: 'delivery_error' })];
    const login = feed(rows, {
      'app-1': application({ failureNote: 'Не доставлено: нужен вход в hh.ru' }),
    });
    expect(login.pinned[0]).toMatchObject({
      kind: 'platform_login_required',
      title: 'Отклик не доставлен · Acme',
      important: true,
    });
    const other = feed(rows, { 'app-1': application({ failureNote: 'Резюме скрыто' }) });
    expect(other.pinned[0]).toMatchObject({
      kind: 'delivery_error',
      title: 'Отклик не доставлен · Acme',
    });
  });

  it('заголовки без компании берут прежний заголовок', () => {
    const rows = [
      source({ id: 'a', kind: 'employer_opened_letter', sourceType: 'x', sourceId: 'x1' }),
      source({ id: 'b', kind: 'email_approval', sourceType: 'x', sourceId: 'x2' }),
      source({ id: 'c', kind: 'import_completed', sourceType: 'import', sourceId: 'i1' }),
    ];
    const titles = Object.fromEntries(feed(rows).items.map((item) => [item.id, item.title]));
    expect(titles).toEqual({
      a: 'Работодатель открыл письмо',
      b: 'Письмо ждёт одобрения',
      c: 'Импорт профиля завершён',
    });
  });

  it('заголовки с компанией для прочих видов', () => {
    const rows = [
      source({ id: 'a', kind: 'employer_opened_letter' }),
      source({ id: 'b', kind: 'email_approval' }),
    ];
    const titles = Object.fromEntries(
      feed(rows, { 'app-1': application() }).items.map((item) => [item.id, item.title]),
    );
    expect(titles).toEqual({ a: 'Acme прочитал отклик', b: 'Acme: письмо ждёт одобрения' });
  });

  it('категории', () => {
    const kinds = [
      'interview_reminder',
      'new_vacancies_by_role',
      'consultant_edits',
      'delivery_error',
    ] as const;
    const rows = kinds.map((kind, index) =>
      source({
        id: kind,
        kind,
        sourceType: 'x',
        sourceId: `s${index}`,
        readAt: '2026-11-19T00:00:00.000Z',
      }),
    );
    const categories = Object.fromEntries(feed(rows).items.map((item) => [item.id, item.category]));
    expect(categories).toEqual({
      interview_reminder: 'invitations',
      new_vacancies_by_role: 'vacancies',
      consultant_edits: 'other',
      delivery_error: 'responses',
    });
  });

  it('B671: напоминание важно до интервью; прошедшее и снятое — нет', () => {
    const row = source({ kind: 'interview_reminder', sourceType: 'interview', sourceId: 'iv-1' });
    const interviewAt = '2026-11-25T09:00:00.000Z';
    const at = (now: string, when: string | null = interviewAt) =>
      buildB640NotificationFeed({
        rows: [row],
        applications: new Map([['iv-1', application({ interviewAt: when })]]),
        unreadCount: 1,
        category: 'all',
        offset: 0,
        limit: 20,
        now,
      });
    expect(at('2026-11-24T10:00:00.000Z').pinned[0]).toMatchObject({
      title: 'Скоро интервью · Acme',
      role: 'Backend',
      eventAt: interviewAt,
    });
    expect(at('2026-11-25T10:00:00.000Z').pinned).toEqual([]);
    expect(at('2026-11-24T10:00:00.000Z', null).pinned).toEqual([]);
  });

  it('важное только пока не прочитано', () => {
    const read = source({ id: 'r', kind: 'delivery_error', readAt: '2026-11-19T00:00:00.000Z' });
    const result = feed([read], { 'app-1': application() });
    expect(result.pinned).toEqual([]);
    expect(result.items[0]?.important).toBe(false);
  });
});

describe('B671: «Новые вакансии по вашей роли» — роль поиска и время подборки', () => {
  it('прежняя запись без числа: заголовок общий, роль — роль поиска, даты события нет', () => {
    const row = source({
      kind: 'new_vacancies_by_role',
      sourceType: 'matched_vacancy_batch',
      sourceId: 'batch-1',
      createdAt: '2026-11-18T17:54:53.869Z',
    });
    const roles = ['Chief Operating Officer', ...Array.from({ length: 10 }, (_, i) => `R${i}`)];
    const [item] = feed([row], {}, { searchRoles: roles }).items;
    expect(item).toMatchObject({
      kind: 'new_vacancies_by_role',
      title: 'Новые вакансии по вашей роли',
      role: 'Chief Operating Officer и ещё 10',
      eventAt: null,
    });
  });

  it('n01b: подборка дня — число и роль в заголовке, роль в подписи не повторяется', () => {
    const row = source({
      kind: 'new_vacancies_by_role',
      sourceType: ROLE_DIGEST_SOURCE_TYPE,
      sourceId: mergeDigestMarks('', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(plain)),
    });
    const [item] = feed([row], {}, { searchRoles: ['Руководитель разработки'] }).items;
    expect(item).toMatchObject({
      title: '6 новых вакансий руководителя разработки',
      role: null,
      eventAt: null,
    });
  });

  it('n01b: несколько ролей — «по вашим ролям», роли в подписи', () => {
    const row = source({
      kind: 'new_vacancies_by_role',
      sourceType: ROLE_DIGEST_SOURCE_TYPE,
      sourceId: mergeDigestMarks('', [plain('c1')]),
    });
    const [item] = feed([row], {}, { searchRoles: ['CTO', 'CIO'] }).items;
    expect(item).toMatchObject({ title: '1 новая вакансия по вашим ролям', role: 'CTO и ещё 1' });
  });

  it('роль поиска не задана — роли нет', () => {
    const row = source({ kind: 'new_vacancies_by_role', sourceType: 'matched_vacancy_batch' });
    const [item] = feed([row]).items;
    expect(item.role).toBeNull();
    expect(item.eventAt).toBeNull();
  });

  it('n01b: находки следа — «Цифровой след: 1 новая находка»', () => {
    const row = source({
      kind: 'footprint_findings',
      sourceType: 'footprint_audit',
      sourceId: 'a1',
    });
    const one = buildB640NotificationFeed({
      rows: [row],
      applications: new Map(),
      unreadCount: 1,
      category: 'all',
      offset: 0,
      limit: 20,
      findingCounts: new Map([['a1', 1]]),
    });
    expect(one.items[0]?.title).toBe('Цифровой след: 1 новая находка');
    expect(footprintTitle(5)).toBe('Цифровой след: 5 новых находок');
    expect(footprintTitle(undefined)).toBe('Цифровой след: новые находки');
  });

  it('подпись роли поиска', () => {
    expect(searchRoleLabel([])).toBeNull();
    expect(searchRoleLabel([' COO '])).toBe('COO');
    expect(searchRoleLabel(['COO', 'CTO', 'CIO'])).toBe('COO и ещё 2');
  });

  it('у прочих событий без отклика роль поиска не подставляется', () => {
    const row = source({ kind: 'consultant_edits', sourceType: 'coach_turn' });
    const [item] = feed([row], {}, { searchRoles: ['COO'] }).items;
    expect(item.role).toBeNull();
    expect(item.eventAt).toBeNull();
  });
});

describe('лента: pinned, фильтр и страницы', () => {
  it('pinned — не больше трёх, новые первыми, вне items; фильтр действует и на pinned', () => {
    const errors = [1, 2, 3, 4].map((day) =>
      source({
        id: `e${day}`,
        kind: 'delivery_error',
        sourceId: `a${day}`,
        createdAt: `2026-11-0${day}T10:00:00.000Z`,
      }),
    );
    const vacancy = source({
      id: 'v',
      kind: 'new_vacancies_by_role',
      sourceType: 'role',
      sourceId: 'r',
    });
    const rows = [...errors, vacancy];
    const all = feed(rows);
    expect(all.pinned.map((item) => item.id)).toEqual(['e4', 'e3', 'e2']);
    expect(all.items.map((item) => item.id).sort()).toEqual(['e1', 'v']);
    const vacancies = feed(rows, {}, { category: 'vacancies' });
    expect(vacancies.pinned).toEqual([]);
    expect(vacancies.items.map((item) => item.id)).toEqual(['v']);
    expect(feed(rows, {}, { category: 'invitations' }).items).toEqual([]);
  });

  it('страницы по смещению и nextCursor', () => {
    const rows = [1, 2, 3, 4, 5].map((n) =>
      source({ id: `m${n}`, kind: 'import_completed', sourceType: 'i', sourceId: `i${n}` }),
    );
    const first = feed(rows, {}, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['m1', 'm2']);
    expect(first.nextCursor).toBe('2');
    const last = feed(rows, {}, { limit: 2, offset: 4 });
    expect(last.items.map((item) => item.id)).toEqual(['m5']);
    expect(last.nextCursor).toBeNull();
    expect(first.unreadCount).toBe(5);
  });
});
