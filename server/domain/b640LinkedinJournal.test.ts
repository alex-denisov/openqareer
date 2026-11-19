import { describe, expect, it } from 'vitest';
import { buildLinkedinJournal, type JournalSources } from './b640LinkedinJournal';

const NOW = new Date('2026-11-19T10:00:00.000Z');

function sources(patch: Partial<JournalSources> = {}): JournalSources {
  return {
    publications: [
      { id: 'queue:q1', kind: 'post', state: 'done', text: 'Платёжная очередь', at: '2026-11-04T07:00:00.000Z', url: 'https://www.linkedin.com/feed/update/1' },
      { id: 'draft:q2', kind: 'comment', state: 'done', text: 'Согласен с Ильёй', at: '2026-11-07T08:00:00.000Z', url: null },
      { id: 'queue:q3', kind: 'post', state: 'removed', text: 'Старый пост', at: '2026-10-30T08:00:00.000Z', url: null },
    ],
    replies: [{ contactId: 'c1', name: 'Павел Ким', at: '2026-11-10T13:05:00.000Z' }],
    timezone: 'Europe/Moscow',
    now: NOW,
    ...patch,
  };
}

describe('buildLinkedinJournal', () => {
  it('собирает публикации, снятия и отметки «ответил» от новых к старым, из двух источников', () => {
    const page = buildLinkedinJournal(sources(), { offset: 0, limit: 20 });
    expect(page.events.map((event) => [event.id, event.kind])).toEqual([
      ['reply:c1', 'replied'],
      ['draft:q2', 'comment_published'],
      ['queue:q1', 'post_published'],
      ['queue:q3', 'removed'],
    ]);
    expect(page.total).toBe(4);
    expect(page.events[0]).toMatchObject({ text: null, url: null, contact: { id: 'c1', name: 'Павел Ким' } });
    expect(page.events[2]).toMatchObject({ text: 'Платёжная очередь', url: 'https://www.linkedin.com/feed/update/1', contact: null });
  });

  it('отдаёт порцию по offset и limit, итоги месяца считает по всем событиям', () => {
    const page = buildLinkedinJournal(sources(), { offset: 1, limit: 2 });
    expect(page.events.map((event) => event.id)).toEqual(['draft:q2', 'queue:q1']);
    expect(page).toMatchObject({ total: 4, offset: 1, limit: 2 });
    expect(page.month).toEqual({ month: '2026-11-01', posts: 1, comments: 1, replies: 1 });
  });

  it('месяц берётся в поясе кандидата: 31 октября 22:30 UTC в Москве — уже ноябрь', () => {
    const page = buildLinkedinJournal(
      sources({
        publications: [{ id: 'queue:q9', kind: 'post', state: 'done', text: 'x', at: '2026-10-31T22:30:00.000Z', url: null }],
        replies: [],
        now: new Date('2026-11-01T00:30:00.000Z'),
      }),
      { offset: 0, limit: 20 },
    );
    expect(page.month).toEqual({ month: '2026-11-01', posts: 1, comments: 0, replies: 0 });
  });

  it('пустой журнал: ноль событий и нулевые итоги', () => {
    const page = buildLinkedinJournal(sources({ publications: [], replies: [] }), { offset: 0, limit: 20 });
    expect(page).toEqual({ events: [], total: 0, offset: 0, limit: 20, month: { month: '2026-11-01', posts: 0, comments: 0, replies: 0 } });
  });
});
