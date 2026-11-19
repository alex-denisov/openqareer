import { describe, expect, it } from 'vitest';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import {
  currentPostDraft,
  draftsOfKind,
} from './linkedinModel';

const draft = (
  id: string,
  kind: 'post' | 'comment',
  status: LinkedinDraft['status'],
): LinkedinDraft => ({
  id,
  kind,
  status,
  topic: id,
  text: 'т',
});

describe('linkedinModel', () => {
  it('отклонённые черновики скрыты, посты и комментарии разделены', () => {
    const all = [
      draft('a', 'post', 'draft'),
      draft('b', 'comment', 'draft'),
      draft('c', 'post', 'rejected'),
    ];
    expect(draftsOfKind(all, 'post').map((item) => item.id)).toEqual(['a']);
    expect(draftsOfKind(all, 'comment').map((item) => item.id)).toEqual(['b']);
  });
  it('текущий пост — первый неопубликованный', () => {
    const all = [draft('a', 'post', 'published'), draft('b', 'post', 'draft')];
    expect(currentPostDraft(all)?.id).toBe('b');
    expect(currentPostDraft([draft('a', 'post', 'published')])).toBeNull();
  });

  it('пост из ссылки «Сегодня» открывается сам, а не первый (B645 s03)', () => {
    const all = [
      draft('a', 'post', 'draft'),
      draft('b', 'post', 'copied'),
      draft('c', 'comment', 'draft'),
    ];
    expect(currentPostDraft(all, 'b')?.id).toBe('b');
    expect(currentPostDraft(all, 'c')?.id).toBe('a');
    expect(currentPostDraft(all, 'нет')?.id).toBe('a');
  });
});
