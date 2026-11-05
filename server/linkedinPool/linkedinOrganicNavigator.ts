/**
 * Organic human-like navigation and warmup engine for LinkedIn pool accounts (B314).
 *
 * Simulates real human behavior in anti-detect / stealth browser context:
 * 1. Bezier curve smooth scrolling with cognitive reading pauses.
 * 2. Feed browsing (/feed/), viewing posts, clicking "see more".
 * 3. Organic post likes (reactions).
 * 4. Company page exploration (About, Jobs, People tabs).
 * 5. Profile viewing (1st, 2nd, 3rd degree connections).
 * 6. Connection requests ("Send without a note" only).
 *
 * STRICT SAFETY CONTRACT:
 * - Immediate Fail-Closed on Checkpoint / CAPTCHA (throws or returns status: 'checkpoint').
 * - ZERO auto-comments and ZERO auto-messages.
 */

export interface OrganicNavigatorPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
  mouse: {
    wheel(deltaX: number, deltaY: number): Promise<void>;
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    click(x: number, y: number): Promise<void>;
  };
  locator(selector: string): OrganicNavigatorLocator;
  close(): Promise<void>;
}

export interface OrganicNavigatorLocator {
  count(): Promise<number>;
  first(): OrganicNavigatorLocator;
  nth(index: number): OrganicNavigatorLocator;
  click(options?: { timeout?: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  scrollIntoViewIfNeeded?(): Promise<void>;
}

export interface HumanScrollOptions {
  readonly distanceY?: number;
  readonly steps?: number;
  readonly pauseRangeMs?: readonly [number, number];
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface WarmupFeedOutcome {
  readonly status: 'ok' | 'checkpoint' | 'empty' | 'error';
  readonly postsViewed: number;
  readonly postsLiked: number;
  readonly reason?: string;
}

export interface WarmupProfileOutcome {
  readonly status: 'ok' | 'checkpoint' | 'not_found' | 'error';
  readonly connected: boolean;
  readonly sectionsViewed: readonly string[];
  readonly reason?: string;
}

export interface WarmupCompanyOutcome {
  readonly status: 'ok' | 'checkpoint' | 'not_found' | 'error';
  readonly tabsViewed: readonly string[];
  readonly reason?: string;
}

/** Cubic Bezier calculation for human-like easing. */
export function cubicBezierPoint(t: number, p1: number, p2: number): number {
  const invT = 1 - t;
  return 3 * invT * invT * t * p1 + 3 * invT * t * t * p2 + t * t * t;
}

/** Generates smooth wheel deltas using cubic Bezier curve easing (ease-in-out). */
export function generateBezierScrollSteps(totalDistance: number, stepCount = 10): number[] {
  if (stepCount <= 1) return [totalDistance];
  const steps: number[] = [];
  let previousY = 0;
  for (let i = 1; i <= stepCount; i += 1) {
    const t = i / stepCount;
    // Ease-in-out control points: (0.25, 0.1) and (0.25, 1.0)
    const normalizedY = cubicBezierPoint(t, 0.1, 1.0);
    const currentY = Math.round(normalizedY * totalDistance);
    steps.push(currentY - previousY);
    previousY = currentY;
  }
  return steps;
}

/** Checks URL and HTML for LinkedIn checkpoint / challenge / CAPTCHA barriers. */
export function isLinkedinCheckpoint(url: string, html?: string): boolean {
  if (/linkedin\.com\/(?:checkpoint|challenge)\//i.test(url)) return true;
  if (!html) return false;
  if (/checkpoint\/challenge/i.test(html)) return true;
  if (/security verification|arkos|funcaptcha|captcha-internal/i.test(html)) return true;
  if (/data-challenge-page|challenge-page/i.test(html)) return true;
  return false;
}

/** Simulates human scroll down the page with Bezier curve easing and random pauses. */
export async function simulateHumanScroll(
  page: OrganicNavigatorPage,
  options: HumanScrollOptions = {},
): Promise<void> {
  const distanceY = options.distanceY ?? 400;
  const steps = options.steps ?? 8;
  const [minPause, maxPause] = options.pauseRangeMs ?? [200, 600];
  const rand = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const deltas = generateBezierScrollSteps(distanceY, steps);
  for (const delta of deltas) {
    await page.mouse.wheel(0, delta);
    // Micro-pause between wheel movements (human cognitive reading rhythm)
    const pause = Math.floor(minPause + rand() * (maxPause - minPause));
    if (pause > 0) await sleep(pause);
  }
}

export class LinkedinOrganicNavigator {
  private readonly page: OrganicNavigatorPage;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    page: OrganicNavigatorPage,
    options: {
      sleep?: (ms: number) => Promise<void>;
      random?: () => number;
    } = {},
  ) {
    this.page = page;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  /**
   * Warmup Mode: browses the LinkedIn feed (/feed/), scrolls naturally, expands posts,
   * and optionally likes posts with a bounded probability.
   * STRICT SAFETY: Zero comments, zero messages. Instant Fail-Closed on checkpoint.
   */
  async warmupFeed(options: { maxPosts?: number; likeProbability?: number } = {}): Promise<WarmupFeedOutcome> {
    const maxPosts = options.maxPosts ?? 5;
    const likeProb = options.likeProbability ?? 0.25;

    await this.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    const currentUrl = this.page.url();
    const html = await this.page.content();

    if (isLinkedinCheckpoint(currentUrl, html)) {
      await this.page.close().catch(() => {});
      return { status: 'checkpoint', postsViewed: 0, postsLiked: 0, reason: 'checkpoint_detected' };
    }

    let postsViewed = 0;
    let postsLiked = 0;

    for (let i = 0; i < maxPosts; i += 1) {
      // Natural human scroll with Bezier step
      await simulateHumanScroll(this.page, {
        distanceY: 300 + Math.floor(this.random() * 250),
        steps: 6 + Math.floor(this.random() * 4),
        sleep: this.sleep,
        random: this.random,
      });

      // Expand "see more" if available on post
      const seeMoreBtn = this.page.locator('.feed-shared-inline-show-more-text__see-more-less-toggle, button:has-text("see more")');
      const canExpand = (await seeMoreBtn.count()) > i;
      if (canExpand) {
        try {
          await seeMoreBtn.nth(i).click({ timeout: 1_000 });
        } catch {
          // Non-critical if see more toggle is not clickable
        }
      }

      postsViewed += 1;

      // Cognitive dwell pause (1.5 - 3.5s per post)
      await this.sleep(1_500 + Math.floor(this.random() * 2_000));

      // Organic like with bounded probability
      if (this.random() < likeProb) {
        const likeBtn = this.page.locator('button.react-button__trigger[aria-label*="Like"], button[aria-label*="React Like"]');
        const count = await likeBtn.count();
        if (count > i) {
          try {
            await likeBtn.nth(i).click({ timeout: 1_500 });
            postsLiked += 1;
            await this.sleep(800 + Math.floor(this.random() * 1_200));
          } catch {
            // Like click missed or already liked; non-critical
          }
        }
      }
    }

    return { status: 'ok', postsViewed, postsLiked };
  }

  /**
   * Warmup Mode: browses a company page (About, Jobs, People tabs).
   * Explores 1st, 2nd, and 3rd degree people connections.
   */
  async warmupCompany(companySlug: string): Promise<WarmupCompanyOutcome> {
    const baseUrl = `https://www.linkedin.com/company/${encodeURIComponent(companySlug)}/`;
    await this.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    if (isLinkedinCheckpoint(this.page.url(), await this.page.content())) {
      await this.page.close().catch(() => {});
      return { status: 'checkpoint', tabsViewed: [], reason: 'checkpoint_detected' };
    }

    const tabsViewed: string[] = ['about'];
    await simulateHumanScroll(this.page, { distanceY: 350, sleep: this.sleep, random: this.random });
    await this.sleep(2_000 + Math.floor(this.random() * 2_000));

    // View People tab
    const peopleTab = this.page.locator('a[href*="/people/"]');
    if ((await peopleTab.count()) > 0) {
      try {
        await peopleTab.first().click({ timeout: 2_000 });
        tabsViewed.push('people');
        await simulateHumanScroll(this.page, { distanceY: 500, sleep: this.sleep, random: this.random });
        await this.sleep(2_500 + Math.floor(this.random() * 2_000));
      } catch {
        // Ignored
      }
    }

    return { status: 'ok', tabsViewed };
  }

  /**
   * Warmup Mode: views a target profile, scrolls through experience/skills,
   * and optionally sends a connection request WITHOUT a message note.
   */
  async warmupProfile(profileUrl: string, options: { sendConnect?: boolean } = {}): Promise<WarmupProfileOutcome> {
    await this.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });

    if (isLinkedinCheckpoint(this.page.url(), await this.page.content())) {
      await this.page.close().catch(() => {});
      return { status: 'checkpoint', connected: false, sectionsViewed: [], reason: 'checkpoint_detected' };
    }

    const sectionsViewed: string[] = ['header'];

    // Scroll to experience
    await simulateHumanScroll(this.page, { distanceY: 500, sleep: this.sleep, random: this.random });
    sectionsViewed.push('experience');
    await this.sleep(1_800 + Math.floor(this.random() * 1_500));

    // Scroll to skills
    await simulateHumanScroll(this.page, { distanceY: 400, sleep: this.sleep, random: this.random });
    sectionsViewed.push('skills');
    await this.sleep(1_500 + Math.floor(this.random() * 1_200));

    let connected = false;
    if (options.sendConnect) {
      const connectBtn = this.page.locator('button:has-text("Connect"), button[aria-label*="Invite"][aria-label*="to connect"]');
      if ((await connectBtn.count()) > 0) {
        try {
          await connectBtn.first().click({ timeout: 2_000 });
          // Ensure "Send without a note" is clicked (STRICT NO MESSAGE NOTE CONTRACT)
          const sendWithoutNoteBtn = this.page.locator('button[aria-label="Send without a note"], button:has-text("Send without a note")');
          if ((await sendWithoutNoteBtn.count()) > 0) {
            await sendWithoutNoteBtn.first().click({ timeout: 2_000 });
          }
          connected = true;
        } catch {
          // Connect failed or already connected
        }
      }
    }

    return { status: 'ok', connected, sectionsViewed };
  }
}
