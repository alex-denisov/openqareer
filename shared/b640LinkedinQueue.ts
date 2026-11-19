/** B694: очередь и ритм публикаций LinkedIn. Только наше хранение: на площадку ничего не уходит. */
export const LINKEDIN_RHYTHM_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type LinkedinRhythmDay = (typeof LINKEDIN_RHYTHM_DAYS)[number];

export interface LinkedinRhythm {
  /** 1..7 постов в неделю; при дне из `days` берётся не больше этого числа на неделю. */
  readonly postsPerWeek: number;
  readonly days: readonly LinkedinRhythmDay[];
  /** Местное время слота `HH:MM` в поясе `timezone`. */
  readonly time: string;
  /** IANA-пояс. */
  readonly timezone: string;
}

export const LINKEDIN_QUEUE_STATES = ['queued', 'due', 'done', 'removed'] as const;
/** `due` вычисляется: время наступило, пост не отмечен опубликованным. */
export type LinkedinQueueState = (typeof LINKEDIN_QUEUE_STATES)[number];

export interface LinkedinQueueItem {
  readonly id: string;
  readonly draftId: string;
  readonly kind: 'post' | 'comment';
  /** Превью текста черновика (до 140 знаков). */
  readonly text: string;
  readonly scheduledAt: string;
  readonly state: LinkedinQueueState;
  readonly updatedAt: string;
  /** Когда показано напоминание «пора опубликовать»; `null` — ещё не показывали. */
  readonly remindedAt: string | null;
  /**
   * Только у строки `due`: куда открыть LinkedIn после «Скопировать и открыть».
   * Пост — окно создания поста, комментарий — ссылка на пост из черновика или `null`.
   */
  readonly openUrl: string | null;
}

export interface LinkedinQueuePage {
  readonly items: readonly LinkedinQueueItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export const LINKEDIN_QUEUE_PAGE_MAX = 20;
export const LINKEDIN_QUEUE_PREVIEW_MAX = 140;
/** Ритм по умолчанию — из макета a05e: рабочие дни, 10:00. Постов в неделю — один (a03b). */
export const DEFAULT_LINKEDIN_RHYTHM_DAYS: readonly LinkedinRhythmDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const DEFAULT_LINKEDIN_RHYTHM_TIME = '10:00';
export const DEFAULT_LINKEDIN_POSTS_PER_WEEK = 1;
export const LINKEDIN_POST_OPEN_URL = 'https://www.linkedin.com/feed/?shareActive=true';
