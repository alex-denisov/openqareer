import type { Page } from 'playwright';
import { linkedinPageNeedsReauth } from './companyPageParser';
import { pageDelayMs, type CadencePageKind } from './linkedinCadencePolicy';

type ReaderPage = Pick<Page, 'content' | 'url' | 'close'> & {
  readonly mouse: Pick<Page['mouse'], 'wheel'>;
  readonly evaluate: (read: () => { height: number; viewport: number }) => Promise<{ height: number; viewport: number }>;
};
export interface LinkedinPageRead {
  readonly status: 'ready' | 'needs_reauth' | 'stopped';
  readonly html?: string;
  readonly reason?: 'challenge_required' | 'expired' | 'login_required';
}
interface ReaderOptions {
  readonly statusCode?: number;
  readonly kind: CadencePageKind;
  readonly signal: AbortSignal;
  readonly random: () => number;
  readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

async function inspect(page: ReaderPage, statusCode?: number): Promise<LinkedinPageRead> {
  const html = await page.content();
  const url = page.url();
  if (!linkedinPageNeedsReauth({ statusCode, url, html })) return { status: 'ready', html };
  const reason = /\/(?:login|uas\/login)(?:\/|\?|$)/iu.test(url)
    ? 'login_required' : statusCode === 401 ? 'expired' : 'challenge_required';
  // A close failure must not turn a provider block into a retryable error.
  await page.close().catch(() => undefined);
  return { status: 'needs_reauth', reason };
}

/** Read only: never click or navigate; stop before interaction with a blocked page. */
export async function readLinkedinPage(page: ReaderPage, options: ReaderOptions): Promise<LinkedinPageRead> {
  const { signal, wait } = options;
  if (signal.aborted) return { status: 'stopped' };
  const initial = await inspect(page, options.statusCode);
  if (initial.status !== 'ready') return initial;
  const { height, viewport } = await page.evaluate(() => ({
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    viewport: window.innerHeight,
  }));
  // Bound work even for an infinite feed; geometry only affects wheel distances.
  const distance = Math.max(0, Math.min(10_000, height - viewport));
  const steps = Math.max(3, Math.min(12, Math.ceil(distance / 500)));
  const weights = Array.from({ length: steps }, (_, i) => 1 + Math.sin(Math.PI * (i + 1) / (steps + 1)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const budget = pageDelayMs(options.kind, options.random);
  let remaining = budget;
  for (const [i, weight] of weights.entries()) {
    if (signal.aborted) return { status: 'stopped' };
    const current = await inspect(page);
    if (current.status !== 'ready') return current;
    if (signal.aborted) return { status: 'stopped' };
    await page.mouse.wheel(0, Math.max(1, Math.round(distance * weight / totalWeight)));
    const pause = i === steps - 1 ? remaining : Math.round(budget * weight / totalWeight);
    remaining -= pause;
    await wait(pause, signal);
  }
  if (signal.aborted) return { status: 'stopped' };
  return inspect(page);
}
