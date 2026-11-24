import type { HhResumeSummary } from './hhCandidateSession';

/**
 * B699: платформа сама поднимает резюме на hh.ru не чаще раза в 4 часа на резюме,
 * исполняет поднятие клиент в окне сессии кандидата. Просмотры и приглашения не читаются.
 */
export const HH_RAISE_EVERY_HOURS = 4;
/** Остановка после капчи, часов. */
export const HH_RAISE_CAPTCHA_PAUSE_HOURS = 24;

/** Московское время с кнопки hh.ru «Поднять в ЧЧ:ММ». */
export const HH_RAISE_CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type HhRaiseOutcome = 'ok' | 'captcha' | 'logged_out' | 'foreign_page' | 'too_early' | 'error';
export type HhRaisePauseReason = 'captcha' | 'logged_out';

export interface B640HhRaiseLastResult {
  readonly status: 'ok' | 'error';
  /** Код причины при `error`; null при `ok`. */
  readonly reason: string | null;
  readonly at: string;
}

/** GET /api/v1/candidate/b640/hh/raise?resumeId= (без resumeId — выбранное резюме, до выбора первое в снимке). */
export interface B640HhRaiseState {
  readonly connected: boolean;
  readonly resumeId: string | null;
  /** Резюме снимка, из которых кандидат выбирает поднимаемое. */
  readonly resumes: readonly HhResumeSummary[];
  readonly enabled: boolean;
  readonly everyHours: typeof HH_RAISE_EVERY_HOURS;
  readonly lastRaisedAt: string | null;
  readonly nextRaiseAt: string | null;
  readonly lastResult: B640HhRaiseLastResult | null;
  readonly pausedUntil: string | null;
  readonly pauseReason: HhRaisePauseReason | null;
  /** По этому резюме есть незавершённое задание (в очереди или исполняется). */
  readonly pending: boolean;
}

/** PUT /hh/raise: `resumeId` становится выбранным, поднимается только оно. */
export interface B640HhRaiseToggle {
  readonly enabled: boolean;
  readonly resumeId?: string;
}

/** POST /hh/raise/claim: клиент берёт готовое к исполнению поднятие; 200 с `task: null`, если задач нет. */
export interface B640HhRaiseClaim {
  readonly task: { readonly taskId: string; readonly resumeId: string } | null;
}

/** POST /hh/raise/:taskId/result */
export interface B640HhRaiseResultBody {
  readonly outcome: HhRaiseOutcome;
  /** Только при `too_early`: когда hh.ru разрешит поднять, ЧЧ:ММ по Москве. */
  readonly availableAt?: string;
}
