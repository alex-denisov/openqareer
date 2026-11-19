/**
 * B396: радар ленты LinkedIn. Ленту платформа не читает: пост приносит кандидат
 * (ссылка и/или вставленный текст), платформа пишет черновик комментария на фактах профиля,
 * кандидат одобряет его (по одному или пачкой) и публикует сам.
 */
export const FEED_POST_TEXT_MAX = 3000;
export const FEED_POST_URL_MAX = 500;
export const FEED_POST_EXCERPT_MAX = 200;
export const FEED_POST_PAGE_MAX = 20;
export const FEED_APPROVE_BATCH_MAX = 20;

/** Черновик → одобрен → в очереди (B694) → опубликован. */
export const FEED_POST_STATES = ['draft', 'approved', 'queued', 'published'] as const;
export type FeedPostState = (typeof FEED_POST_STATES)[number];

/** `POST /api/v1/candidate/b640/linkedin/feed-posts`: нужно хотя бы одно из полей. */
export interface FeedPostCreateRequest {
  readonly url?: string;
  readonly text: string;
}
export interface FeedPostCreated {
  readonly draftId: string;
  /** Ссылка на пост без параметров запроса и якоря; `null`, если принесён только текст. */
  readonly postUrl: string | null;
  /** Начало принесённого текста; пустая строка, если принесена только ссылка. */
  readonly postExcerpt: string;
  readonly comment: string;
}

export interface FeedPostItem extends FeedPostCreated {
  readonly state: FeedPostState;
  readonly createdAt: string;
  /** Время слота очереди, когда `state` — `queued`. */
  readonly scheduledAt: string | null;
}
export interface FeedPostPage {
  readonly items: readonly FeedPostItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

/** `POST …/feed-posts/approve`. */
export interface FeedApproveRequest {
  readonly draftIds: readonly string[];
}
export const FEED_APPROVE_REASONS = ['not_found', 'already_published', 'already_queued', 'no_slot'] as const;
export type FeedApproveReason = (typeof FEED_APPROVE_REASONS)[number];
export type FeedApproveResult =
  | { readonly draftId: string; readonly ok: true; readonly scheduledAt: string; readonly queueItemId: string }
  | { readonly draftId: string; readonly ok: false; readonly reason: FeedApproveReason };
export interface FeedApproveResponse {
  readonly results: readonly FeedApproveResult[];
}
