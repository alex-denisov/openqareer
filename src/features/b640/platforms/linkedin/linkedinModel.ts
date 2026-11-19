import type { LinkedinDraft, LinkedinDraftStatus } from '../../../today/linkedinDraftApi';
import { formatDay } from '../format';

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
