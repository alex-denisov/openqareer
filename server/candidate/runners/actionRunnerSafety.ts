import type { Page, Route } from 'playwright';
import { isAllowedCandidateActionTarget } from '../../../shared/candidateActionPolicy';

export type CandidateActionPlatform = 'hh' | 'linkedin';

export async function withAllowedMainFrameNavigation<T>(
  page: Page,
  platform: CandidateActionPlatform,
  action: () => Promise<T>,
): Promise<T> {
  const guard = (route: Route) => guardMainFrameRoute(route, page, platform);
  await page.route('**/*', guard);
  try {
    return await action();
  } finally {
    await page.unroute('**/*', guard);
  }
}

async function guardMainFrameRoute(
  route: Route,
  page: Page,
  platform: CandidateActionPlatform,
): Promise<void> {
  const request = route.request();
  if (
    request.isNavigationRequest() &&
    request.frame() === page.mainFrame() &&
    !isAllowedCandidateActionTarget(platform, request.url())
  ) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.fallback();
}

export async function blockedPageReason(
  page: Page,
  responseStatus?: number,
): Promise<string | null> {
  if (responseStatus === 403) return 'http_403';
  const url = page.url().toLowerCase();
  if (/\/(?:login|checkpoint|authwall)(?:\/|$)/u.test(new URL(url).pathname)) {
    return url.includes('checkpoint') || url.includes('authwall') ? 'challenge_required' : 'login_required';
  }
  const text = `${await page.title().catch(() => '')}\n${await page.locator('body').innerText().catch(() => '')}`
    .toLowerCase();
  return /captcha|verify (?:that )?you(?:'|’)re human|unusual activity|security check|access denied|forbidden|\b403\b/u.test(text)
    ? 'challenge_required'
    : null;
}

export function sameTargetRoute(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);
    return target.hostname === current.hostname && target.pathname === current.pathname;
  } catch {
    return false;
  }
}

export async function hasVisible(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector);
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) return true;
  }
  return false;
}

export function safeErrorCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : 'platform_action_failed';
}
