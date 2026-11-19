import type { LinkedinDraft, LinkedinDraftStatus } from '../../../today/linkedinDraftApi';
import type { ResumeDocument } from '../../../resume/resumeTypes';
import { formatDay } from '../format';

const HEADLINE_MAX = 220;
const ABOUT_MAX = 2600;
const HEADLINE_SKILLS = 4;
const SKILLS_MAX = 50;

export interface ProfileRecord {
  readonly label: string | null;
  readonly text: string;
}

export interface ProfileSection {
  readonly id: 'headline' | 'about' | 'experience' | 'skills';
  readonly title: string;
  readonly records: readonly ProfileRecord[];
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

function experienceRecords(document: ResumeDocument): readonly ProfileRecord[] {
  return (document.experience ?? []).flatMap((job) => {
    const parts = [job.description?.value, ...job.bullets.map((bullet) => bullet.value)]
      .map((part) => (part ?? '').trim())
      .filter(Boolean);
    const label = [job.employer?.value, job.title?.value].filter(Boolean).join(' · ');
    return parts.length ? [{ label: label || null, text: parts.join(' ') }] : [];
  });
}

const single = (text: string): readonly ProfileRecord[] => (text ? [{ label: null, text }] : []);

/** Разделы профиля с готовым текстом для вставки; пустые разделы не показываем. */
export function buildProfileSections(document: ResumeDocument): readonly ProfileSection[] {
  const sections: ProfileSection[] = [
    { id: 'headline', title: 'Заголовок', records: single(buildHeadline(document)) },
    {
      id: 'about',
      title: 'О себе',
      records: single((document.about ?? '').trim().slice(0, ABOUT_MAX)),
    },
    { id: 'experience', title: 'Опыт', records: experienceRecords(document) },
    {
      id: 'skills',
      title: 'Навыки',
      records: single(skillNames(document, SKILLS_MAX).join(' · ')),
    },
  ];
  return sections.filter((section) => section.records.length > 0);
}

export interface PublicationTag {
  readonly label: string;
  readonly className: string;
}

const TAGS: Readonly<Record<Exclude<LinkedinDraftStatus, 'rejected'>, PublicationTag>> = {
  draft: { label: 'черновик', className: 'tag part' },
  copied: { label: 'скопирован', className: 'tag part' },
  approved: { label: 'в очереди', className: 'tag' },
  published: { label: 'опубликован', className: 'tag ok' },
};

/** Отклонённые черновики в списке не показываем. */
export function visibleDrafts(drafts: readonly LinkedinDraft[]): readonly LinkedinDraft[] {
  return drafts.filter((draft) => draft.status !== 'rejected');
}

export function draftTag(status: LinkedinDraftStatus): PublicationTag {
  return status === 'rejected' ? TAGS.draft : TAGS[status];
}

/** Дата строки: только когда опубликован; срока публикации у черновика и очереди в данных нет. */
export function draftDate(draft: LinkedinDraft): string | null {
  return draft.status === 'published' ? formatDay(draft.publishedAt) : null;
}

/** «3 поста»: число постов, к которым готов комментарий. */
export function postsCount(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  const word =
    tail >= 11 && tail <= 14
      ? 'постов'
      : last === 1
        ? 'пост'
        : last >= 2 && last <= 4
          ? 'поста'
          : 'постов';
  return `${count} ${word}`;
}

export function draftsOfKind(
  drafts: readonly LinkedinDraft[],
  kind: LinkedinDraft['kind'],
): readonly LinkedinDraft[] {
  return visibleDrafts(drafts).filter((draft) => draft.kind === kind);
}

/** Черновик, с которого начинается экран постов: первый, ещё не опубликованный. */
export function currentPostDraft(
  drafts: readonly LinkedinDraft[],
  preferredId?: string | null,
): LinkedinDraft | null {
  const open = draftsOfKind(drafts, 'post').filter(
    (draft) => draft.status === 'draft' || draft.status === 'copied',
  );
  // Пост из ссылки «Сегодня» (?post=id) — первым, иначе первый неопубликованный (B645 s03).
  return open.find((draft) => draft.id === preferredId) ?? open[0] ?? null;
}
