import { describe, expect, it } from 'vitest';
import { buildB640NotificationFeed, type B640NotificationSource } from './b640Notifications';
import { mergeDigestMarks, ROLE_DIGEST_SOURCE_TYPE } from './roleDigestMarks';

function row(
  id: string,
  kind: B640NotificationSource['kind'],
  createdAt: string,
  overrides: Partial<B640NotificationSource> = {},
): B640NotificationSource {
  return { id, kind, sourceType: 'x', sourceId: id, createdAt, readAt: null, ...overrides };
}

function feed(rows: B640NotificationSource[]) {
  return buildB640NotificationFeed({
    rows,
    applications: new Map(),
    unreadCount: rows.filter((item) => item.readAt === null).length,
    category: 'all',
    offset: 0,
    limit: 20,
  });
}

describe('n01b: повторы за день — одна строка (B801 С1)', () => {
  it('сворачивает вакансии, находки и правки одного дня, счётчик считает строки', () => {
    const result = feed([
      row('v3', 'new_vacancies_by_role', '2026-11-23T18:00:00.000Z'),
      row('v2', 'new_vacancies_by_role', '2026-11-23T12:00:00.000Z'),
      row('c2', 'consultant_edits', '2026-11-23T11:00:00.000Z'),
      row('c1', 'consultant_edits', '2026-11-23T10:00:00.000Z', { readAt: '2026-11-23T10:30:00Z' }),
      row('v1', 'new_vacancies_by_role', '2026-11-22T12:00:00.000Z'),
    ]);
    expect(result.items.map((item) => item.id)).toEqual(['v3', 'c2', 'v1']);
    expect(result.items[0]?.mergedUnreadIds).toEqual(['v2']);
    expect(result.items[1]?.mergedUnreadIds).toBeUndefined();
    expect(result.unreadCount).toBe(3);
  });

  it('прочитанная строка с непрочитанным повтором остаётся непрочитанной', () => {
    const result = feed([
      row('f2', 'footprint_findings', '2026-11-23T12:00:00.000Z', {
        readAt: '2026-11-23T13:00:00Z',
      }),
      row('f1', 'footprint_findings', '2026-11-23T10:00:00.000Z'),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ readAt: null, mergedUnreadIds: ['f1'] });
    expect(result.unreadCount).toBe(1);
  });

  it('число вакансий — объединение записей дня без двойного счёта', () => {
    const marks = (...ids: string[]) =>
      mergeDigestMarks(
        '',
        ids.map((id) => ({ id, aboveFloor: false })),
      );
    const digest = (id: string, sourceId: string) =>
      row(id, 'new_vacancies_by_role', '2026-11-24T12:00:00.000Z', {
        sourceType: ROLE_DIGEST_SOURCE_TYPE,
        sourceId,
      });
    const result = feed([
      row('old', 'new_vacancies_by_role', '2026-11-24T13:00:00.000Z'),
      digest('a', marks('1', '2')),
      digest('b', marks('2', '3')),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toMatch(/^3 /u);
  });

  it('ответы работодателей не сворачиваются', () => {
    const at = '2026-11-23T12:00:00.000Z';
    expect(
      feed([row('r1', 'employer_reply', at), row('r2', 'employer_reply', at)]).items,
    ).toHaveLength(2);
  });
});
