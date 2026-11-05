import { describe, expect, it, vi } from 'vitest';
import {
  generateBezierScrollSteps,
  isLinkedinCheckpoint,
  simulateHumanScroll,
  LinkedinOrganicNavigator,
  type OrganicNavigatorPage,
  type OrganicNavigatorLocator,
} from './linkedinOrganicNavigator';

function createMockLocator(count = 10): OrganicNavigatorLocator {
  return {
    count: vi.fn(async () => count),
    first: vi.fn(() => createMockLocator(count)),
    nth: vi.fn(() => createMockLocator(count)),
    click: vi.fn(async () => {}),
    isVisible: vi.fn(async () => true),
  };
}

function createMockPage(options: { url?: string; html?: string; locatorCounts?: Record<string, number> } = {}): OrganicNavigatorPage {
  const currentUrl = options.url ?? 'https://www.linkedin.com/feed/';
  const html = options.html ?? '<html><body><div id="feed"></div></body></html>';
  return {
    goto: vi.fn(async () => {}),
    url: vi.fn(() => currentUrl),
    content: vi.fn(async () => html),
    evaluate: vi.fn(async () => undefined as never),
    mouse: {
      wheel: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      click: vi.fn(async () => {}),
    },
    locator: vi.fn((selector: string) => {
      const count = options.locatorCounts?.[selector] ?? 10;
      return createMockLocator(count);
    }),
    close: vi.fn(async () => {}),
  };
}

describe('LinkedinOrganicNavigator (B314)', () => {
  describe('Bezier smooth scrolling', () => {
    it('generates non-linear Bezier scroll steps summing to the total distance', () => {
      const totalDistance = 500;
      const steps = generateBezierScrollSteps(totalDistance, 8);
      expect(steps).toHaveLength(8);
      const sum = steps.reduce((acc, step) => acc + step, 0);
      expect(sum).toBe(totalDistance);
      // Non-linear: middle steps have larger deltas than start/end
      expect(steps[3]).toBeGreaterThan(steps[0]!);
    });

    it('simulates human scroll with wheel deltas and micro-pauses', async () => {
      const page = createMockPage();
      const sleep = vi.fn(async () => {});
      await simulateHumanScroll(page, { distanceY: 400, steps: 5, sleep });
      expect(page.mouse.wheel).toHaveBeenCalledTimes(5);
      expect(sleep).toHaveBeenCalledTimes(5);
    });
  });

  describe('Checkpoint & CAPTCHA detection (Fail-Closed)', () => {
    it('detects checkpoint in url', () => {
      expect(isLinkedinCheckpoint('https://www.linkedin.com/checkpoint/challenge/123')).toBe(true);
      expect(isLinkedinCheckpoint('https://www.linkedin.com/feed/')).toBe(false);
    });

    it('detects checkpoint and captcha signatures in page html', () => {
      expect(isLinkedinCheckpoint('https://www.linkedin.com/feed/', '<div class="challenge-page">Security verification</div>')).toBe(true);
      expect(isLinkedinCheckpoint('https://www.linkedin.com/feed/', '<div>Arkos challenge</div>')).toBe(true);
      expect(isLinkedinCheckpoint('https://www.linkedin.com/feed/', '<div>Normal feed content</div>')).toBe(false);
    });

    it('immediately aborts and closes page on checkpoint during feed warmup', async () => {
      const page = createMockPage({
        url: 'https://www.linkedin.com/checkpoint/challenge/arkos',
        html: '<div>Security verification</div>',
      });
      const navigator = new LinkedinOrganicNavigator(page, { sleep: async () => {} });
      const outcome = await navigator.warmupFeed();
      expect(outcome.status).toBe('checkpoint');
      expect(page.close).toHaveBeenCalledOnce();
      expect(page.mouse.wheel).not.toHaveBeenCalled();
    });

    it('immediately aborts and closes page on checkpoint during profile warmup', async () => {
      const page = createMockPage({
        url: 'https://www.linkedin.com/checkpoint/rp/login',
        html: '<div>Challenge</div>',
      });
      const navigator = new LinkedinOrganicNavigator(page, { sleep: async () => {} });
      const outcome = await navigator.warmupProfile('https://www.linkedin.com/in/test-recruiter/');
      expect(outcome.status).toBe('checkpoint');
      expect(page.close).toHaveBeenCalledOnce();
    });
  });

  describe('Feed Warmup', () => {
    it('scrolls through feed, expands posts, and occasionally likes posts', async () => {
      const page = createMockPage();
      const sleep = vi.fn(async () => {});
      // Fixed random: 0.1 < likeProbability (0.3) so likes trigger
      const navigator = new LinkedinOrganicNavigator(page, { sleep, random: () => 0.1 });
      const outcome = await navigator.warmupFeed({ maxPosts: 3, likeProbability: 0.3 });

      expect(outcome.status).toBe('ok');
      expect(outcome.postsViewed).toBe(3);
      expect(outcome.postsLiked).toBe(3);
      expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
      expect(page.mouse.wheel).toHaveBeenCalled();
    });
  });

  describe('Company Warmup', () => {
    it('views company page and explores About and People tabs', async () => {
      const page = createMockPage();
      const sleep = vi.fn(async () => {});
      const navigator = new LinkedinOrganicNavigator(page, { sleep, random: () => 0.5 });
      const outcome = await navigator.warmupCompany('google');

      expect(outcome.status).toBe('ok');
      expect(outcome.tabsViewed).toContain('about');
      expect(outcome.tabsViewed).toContain('people');
      expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/company/google/', { waitUntil: 'domcontentloaded' });
    });
  });

  describe('Profile Warmup & Connect', () => {
    it('scrolls profile sections and sends connection request without a note', async () => {
      const page = createMockPage();
      const sleep = vi.fn(async () => {});
      const navigator = new LinkedinOrganicNavigator(page, { sleep, random: () => 0.5 });
      const outcome = await navigator.warmupProfile('https://www.linkedin.com/in/alice-recruiter/', { sendConnect: true });

      expect(outcome.status).toBe('ok');
      expect(outcome.sectionsViewed).toContain('experience');
      expect(outcome.sectionsViewed).toContain('skills');
      expect(outcome.connected).toBe(true);
      expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/in/alice-recruiter/', { waitUntil: 'domcontentloaded' });
    });
  });
});
