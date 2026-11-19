import { describe, expect, it } from 'vitest';
import {
  buildB640NotificationFeed,
  type B640ApplicationContext,
  type B640NotificationSource,
} from './b640Notifications';

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
  } = {},
) {
  return buildB640NotificationFeed({
    rows,
    applications: new Map(Object.entries(apps)),
    unreadCount: rows.filter((row) => row.readAt === null).length,
    category: options.category ?? 'all',
    offset: options.offset ?? 0,
    limit: options.limit ?? 20,
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

  it('важное только пока не прочитано', () => {
    const read = source({ id: 'r', kind: 'delivery_error', readAt: '2026-11-19T00:00:00.000Z' });
    const result = feed([read], { 'app-1': application() });
    expect(result.pinned).toEqual([]);
    expect(result.items[0]?.important).toBe(false);
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
