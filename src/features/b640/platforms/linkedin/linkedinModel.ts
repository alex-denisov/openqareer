import type { LinkedinDraft, LinkedinDraftStatus } from '../../../today/linkedinDraftApi';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import { formatDay } from '../format';

const HEADLINE_MAX = 220;
const ABOUT_MAX = 2600;
const HEADLINE_SKILLS = 4;
const SKILLS_MAX = 50;

export interface ProfileSection {
  readonly id: 'headline' | 'about' | 'skills';
  readonly title: string;
  readonly text: string;
}

function skillNames(document: ResumeDocument, limit: number): string[] {
  return (document.skills ?? [])
    .map((skill) => skill.name.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** «Роль · навык · навык»: только то, что уже есть в резюме, не длиннее предела LinkedIn. */
export function buildHeadline(document: ResumeDocument): string {
  const role = (document.targetRole ?? '').trim();
  const parts = [...(role ? [role] : []), ...skillNames(document, HEADLINE_SKILLS)];
  return parts.join(' · ').slice(0, HEADLINE_MAX);
}

/** Разделы профиля с готовым текстом для вставки; пустые разделы не показываем. */
export function buildProfileSections(document: ResumeDocument): readonly ProfileSection[] {
  const sections: ProfileSection[] = [
    { id: 'headline', title: 'Заголовок', text: buildHeadline(document) },
    { id: 'about', title: 'О себе', text: (document.about ?? '').trim().slice(0, ABOUT_MAX) },
    { id: 'skills', title: 'Навыки', text: skillNames(document, SKILLS_MAX).join(' · ') },
  ];
  return sections.filter((section) => section.text.length > 0);
}

export interface PublicationTag {
  readonly label: string;
  readonly className: string;
}

const TAGS: Readonly<Record<Exclude<LinkedinDraftStatus, 'rejected'>, PublicationTag>> = {
  draft: { label: 'черновик', className: 'tag part' },
  copied: { label: 'скопирован', className: 'tag part' },
  approved: { label: 'одобрен', className: 'tag' },
  published: { label: 'опубликован', className: 'tag ok' },
};

/** Отклонённые черновики в списке не показываем. */
export function visibleDrafts(drafts: readonly LinkedinDraft[]): readonly LinkedinDraft[] {
  return drafts.filter((draft) => draft.status !== 'rejected');
}

export function draftTag(status: LinkedinDraftStatus): PublicationTag {
  return status === 'rejected' ? TAGS.draft : TAGS[status];
}

/** Дата строки: когда опубликован или одобрен; у черновика даты нет. */
export function draftDate(draft: LinkedinDraft): string | null {
  return formatDay(draft.publishedAt ?? draft.approvedAt);
}

export function draftsOfKind(drafts: readonly LinkedinDraft[], kind: LinkedinDraft['kind']): readonly LinkedinDraft[] {
  return visibleDrafts(drafts).filter((draft) => draft.kind === kind);
}

/** Черновик, с которого начинается экран постов: первый, ещё не опубликованный. */
export function currentPostDraft(drafts: readonly LinkedinDraft[]): LinkedinDraft | null {
  return draftsOfKind(drafts, 'post').find((draft) => draft.status === 'draft' || draft.status === 'copied') ?? null;
}
