import type { SessionPageResult } from './connectorSession';

/**
 * How many times a page is read after the sign-in has already been recognised.
 * Three reads across ~1.3 s of backoff cover a slow single-page transition
 * without leaving the candidate waiting in front of a hidden window.
 */
const CAPTURE_ATTEMPTS = 3;
const CAPTURE_RETRY_BACKOFF_MS = [400, 900];

export interface SessionCaptureOptions<T> {
  /** Reads the page inside the candidate's own signed-in session window. */
  readonly read: () => Promise<SessionPageResult>;
  /**
   * Turns a response into what the flow needs, or `undefined` when this is not
   * the page it asked for and another read is worth making.
   */
  readonly interpret: (page: SessionPageResult & { readonly body: string }) => T | undefined;
  /**
   * Whether the platform is challenging the candidate. Another read cannot
   * answer a captcha or a one-time code, so retrying it only wastes the wait.
   */
  readonly isChallenge?: (body: string) => boolean;
  /** Thrown when every attempt is spent. */
  readonly failureCode: string;
  /** Injected so tests do not sit through the real backoff. */
  readonly waitBeforeRetry?: (attempt: number) => Promise<void>;
}

/**
 * Reads a page after the candidate is already signed in, surviving a single
 * dropped or slow read.
 *
 * By this point the sign-in window is hidden and the step has closed, so
 * nothing will poll again: one transient failure used to discard a completed
 * sign-in and send the candidate back to the login window from scratch (B157).
 */
export async function captureSignedInPage<T>(
  options: SessionCaptureOptions<T>,
): Promise<T> {
  const wait = options.waitBeforeRetry ?? defaultRetryWait;
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(attempt);
    const page = await options
      .read()
      .catch((): SessionPageResult => ({ ok: false }));
    if (!page.ok || !page.body) continue;
    if (options.isChallenge?.(page.body)) break;
    const captured = options.interpret({ ...page, body: page.body });
    if (captured !== undefined) return captured;
  }
  throw new Error(options.failureCode);
}

function defaultRetryWait(attempt: number): Promise<void> {
  const delay =
    CAPTURE_RETRY_BACKOFF_MS[attempt - 1] ?? CAPTURE_RETRY_BACKOFF_MS.at(-1) ?? 0;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
