/**
 * B696: журнал LinkedIn кандидата — только собственные события платформы и отметки кандидата.
 * Ответы и реакции на LinkedIn не читаются (условия площадки, вердикт исследования 16.11).
 */
export const LINKEDIN_JOURNAL_KINDS = ['post_published', 'comment_published', 'removed', 'replied'] as const;
export type LinkedinJournalKind = (typeof LINKEDIN_JOURNAL_KINDS)[number];

export interface LinkedinJournalEvent {
  /** `queue:<id>` для публикаций и снятий, `reply:<contactId>` для отметки «ответил». */
  readonly id: string;
  readonly kind: LinkedinJournalKind;
  readonly at: string;
  /** Превью текста поста или комментария; у «ответил» — `null`. */
  readonly text: string | null;
  /** Ссылка на публикацию, если кандидат её оставил. */
  readonly url: string | null;
  /** Кто ответил: только у `replied`. */
  readonly contact: { readonly id: string; readonly name: string } | null;
}

export interface LinkedinJournalMonth {
  /** Первый день месяца `YYYY-MM-01` в поясе кандидата. */
  readonly month: string;
  readonly posts: number;
  readonly comments: number;
  readonly replies: number;
}

export interface LinkedinJournalPage {
  readonly events: readonly LinkedinJournalEvent[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly month: LinkedinJournalMonth;
}

export const LINKEDIN_JOURNAL_PAGE_MAX = 20;
