import { describe, expect, it } from 'vitest';
import type { LinkedinDraft } from '../../../today/linkedinDraftApi';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import { buildHeadline, buildProfileSections, currentPostDraft, draftsOfKind } from './linkedinModel';

const doc = (patch: Record<string, unknown>) => ({ targetRole: null, about: null, skills: [], ...patch }) as unknown as ResumeDocument;
const draft = (id: string, kind: 'post' | 'comment', status: LinkedinDraft['status']): LinkedinDraft => ({
  id, kind, status, topic: id, text: 'т',
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
    expect(sections[0]!.text).toBe('Обо мне');
  });
  it('отклонённые черновики скрыты, посты и комментарии разделены', () => {
    const all = [draft('a', 'post', 'draft'), draft('b', 'comment', 'draft'), draft('c', 'post', 'rejected')];
    expect(draftsOfKind(all, 'post').map((item) => item.id)).toEqual(['a']);
    expect(draftsOfKind(all, 'comment').map((item) => item.id)).toEqual(['b']);
  });
  it('текущий пост — первый неопубликованный', () => {
    const all = [draft('a', 'post', 'published'), draft('b', 'post', 'draft')];
    expect(currentPostDraft(all)?.id).toBe('b');
    expect(currentPostDraft([draft('a', 'post', 'published')])).toBeNull();
  });
});
