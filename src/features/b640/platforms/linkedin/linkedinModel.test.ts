import { describe, expect, it } from 'vitest';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import {
  buildHeadline,
  buildProfileSections,
  currentPostDraft,
  draftsOfKind,
} from './linkedinModel';

const doc = (patch: Record<string, unknown>) =>
  ({ targetRole: null, about: null, skills: [], ...patch }) as unknown as ResumeDocument;
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
  it('заголовок: роль и четыре навыка через « · »', () => {
    const skills = ['Go', 'Kotlin', 'SQL', 'K8s', 'Lead'].map((name) => ({ id: name, name }));
    expect(buildHeadline(doc({ targetRole: 'Руководитель разработки', skills }))).toBe(
      'Руководитель разработки · Go · Kotlin · SQL · K8s',
    );
  });
  it('пустые разделы не попадают в список', () => {
    const sections = buildProfileSections(doc({ about: ' Обо мне ', skills: [] }));
    expect(sections.map((section) => section.id)).toEqual(['about']);
    expect(sections[0]!.records).toEqual([{ label: null, text: 'Обо мне' }]);
  });
  it('опыт: запись на место работы с подписью «компания · должность»', () => {
    const asr = (value: string) => ({
      value,
      memoryId: 'm',
      sourceMessageIds: [],
      reviewFlags: [],
    });
    const experience = [
      {
        id: 'e1',
        employer: asr('Финтех Лаб'),
        title: asr('Руководитель'),
        description: asr('Группа из 9 человек.'),
        bullets: [asr('Релиз раз в 3 дня.')],
      },
      { id: 'e2', employer: asr('Пусто'), title: null, bullets: [] },
    ];
    const sections = buildProfileSections(doc({ experience }));
    expect(sections.map((section) => section.id)).toEqual(['experience']);
    expect(sections[0]!.records).toEqual([
      { label: 'Финтех Лаб · Руководитель', text: 'Группа из 9 человек. Релиз раз в 3 дня.' },
    ]);
  });
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
