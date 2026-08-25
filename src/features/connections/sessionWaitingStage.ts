import type { SessionInspectionResult } from './connectorSession';

/**
 * Why a connector flow is still waiting.
 *
 * One opaque "waiting" state made a loading page, a one-time-code prompt and an
 * unrecognised signed-in page look identical on screen — nothing ever changed —
 * and the last of those is the failure the candidate can neither see nor act on
 * (B157). hh.ru and LinkedIn read the same inspection report, so they classify
 * it the same way.
 */
export type SessionWaitingStage =
  | 'loading'
  | 'login'
  | 'otp'
  | 'captcha'
  | 'unrecognised';

/**
 * A page the platform itself is challenging outranks readiness: a captcha or a
 * code prompt is what the candidate must act on, whatever `readyState` says.
 */
export function sessionWaitingStage(page: SessionInspectionResult): SessionWaitingStage {
  if (page.captcha) return 'captcha';
  if (page.otp) return 'otp';
  if (page.login) return 'login';
  if (!page.ready) return 'loading';
  return 'unrecognised';
}

export interface SessionWaitingNotice {
  readonly text: string;
  /** The step has stopped making progress and must offer another route. */
  readonly stuck: boolean;
}

/**
 * How long an already-loaded, unchallenged page may stay unrecognised before
 * the step admits it and offers the candidate another route. ~18 s at the
 * 750 ms poll interval: long enough for a slow single-page transition, short
 * enough that nobody sits in front of a still screen.
 */
export const UNRECOGNISED_PATIENCE_POLLS = 24;

export interface SessionWaitingCopy {
  readonly loading: string;
  readonly login: string;
  readonly otp: string;
  readonly captcha: string;
  readonly checking: string;
  readonly unrecognised: string;
}

/**
 * What the candidate is told while the flow waits. A challenge the platform is
 * showing (code, captcha, its own sign-in form) is not a stall — the candidate
 * is the one being asked to act, so the flow waits as long as it takes. A page
 * that is loaded, unchallenged and still carries no signed-in marker is the
 * failure the owner reported, and it must eventually say so out loud (B157).
 */
export function sessionWaitingNotice(
  stage: SessionWaitingStage,
  unrecognisedPolls: number,
  copy: SessionWaitingCopy,
): SessionWaitingNotice {
  switch (stage) {
    case 'loading':
      return { text: copy.loading, stuck: false };
    case 'login':
      return { text: copy.login, stuck: false };
    case 'otp':
      return { text: copy.otp, stuck: false };
    case 'captcha':
      return { text: copy.captcha, stuck: false };
    default:
      return unrecognisedPolls >= UNRECOGNISED_PATIENCE_POLLS
        ? { text: copy.unrecognised, stuck: true }
        : { text: copy.checking, stuck: false };
  }
}

/**
 * What to say when the page could not be read at all.
 *
 * Before a sign-in is recognised nothing has been captured yet, so a webview
 * that refuses to run script mid-navigation is something to wait through, not
 * a failed import. Reporting it as "вход выполнен, но данные получить не
 * удалось" — and closing the sign-in window on the way — is what left the
 * candidate with no window and no explanation (B157). It cannot wait forever
 * either: past the patience limit the step says what actually went wrong.
 */
export function sessionUnreadableNotice(
  explanation: string,
  consecutiveFailures: number,
  loadingText: string,
): SessionWaitingNotice {
  return consecutiveFailures >= UNRECOGNISED_PATIENCE_POLLS
    ? { text: explanation, stuck: true }
    : { text: loadingText, stuck: false };
}
