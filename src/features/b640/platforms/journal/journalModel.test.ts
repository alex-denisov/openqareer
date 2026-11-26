import { describe, expect, it } from 'vitest';
import type { LinkedinJournalEvent } from '../../../../../shared/b640LinkedinJournal';
import { givenNameDative, journalRow, journalTotals, leadReply, monthTitle } from './journalModel';

const event = (patch: Partial<LinkedinJournalEvent>): LinkedinJournalEvent => ({
  id: 'queue:q1', kind: 'post_published', at: '2026-11-04T07:00:00.000Z', text: 'Платёжная очередь без потерь на пиках', url: null, contact: null, ...patch,
});

describe('journalRow', () => {
  it('пост: заголовок, текст в кавычках и время, метка «опубликован»', () => {
    const row = journalRow(event({}));
    expect(row.title).toBe('Пост опубликован');
    expect(row.sub).toMatch(/^«Платёжная очередь без потерь на пиках» · 4 ноября, \d\d:00$/u);
    expect(row.tag).toEqual({ text: 'опубликован', ok: false });
  });
  it('комментарий и снятие из очереди', () => {
    expect(journalRow(event({ kind: 'comment_published' })).title).toBe('Комментарий опубликован');
    expect(journalRow(event({ kind: 'removed' }))).toMatchObject({ title: 'Убрано из очереди', tag: { text: 'убран', ok: false } });
  });
  it('«ответил»: имя контакта, только время, метка ok', () => {
    const row = journalRow(event({ id: 'reply:c1', kind: 'replied', text: null, contact: { id: 'c1', name: 'Павел Ким' } }));
    expect(row.title).toBe('Павел Ким ответил');
    expect(row.sub).not.toContain('«');
    expect(row.tag).toEqual({ text: 'ответил', ok: true });
  });
  it('нечитаемая дата не попадает в строку', () => {
    expect(journalRow(event({ at: 'x' })).sub).toBe('«Платёжная очередь без потерь на пиках»');
  });
});

describe('leadReply и имя в дательном', () => {
  it('первый «ответил» на странице ведёт экран; без него — null', () => {
    const reply = event({ id: 'reply:c1', kind: 'replied', contact: { id: 'c1', name: 'Павел Ким' } });
    expect(leadReply([event({}), reply])).toEqual({ id: 'c1', name: 'Павел Ким' });
    expect(leadReply([event({})])).toBeNull();
  });
  it('«Написать Павлу», «Роману», «Марии», «Илье»', () => {
    expect(['Павел Ким', 'Роман Ефимов', 'Мария Орлова', 'Илья Громов', 'Лев Гуров'].map(givenNameDative)).toEqual([
      'Павлу', 'Роману', 'Марии', 'Илье', 'Льву',
    ]);
  });
});

describe('итоги месяца', () => {
  it('«За ноябрь»: посты, комментарии, ответы; реакций нет', () => {
    const month = { month: '2026-11-01', posts: 1, comments: 4, replies: 2 };
    expect(monthTitle(month)).toBe('За ноябрь');
    expect(journalTotals(month).map((item) => [item.label, item.value])).toEqual([
      ['Посты', 1], ['Комментарии', 4], ['Ответы', 2],
    ]);
  });
});
