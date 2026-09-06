import { evaluateRobotsPolicy } from './robotsParser';
import type { RobotsVerdictStatus } from './robotsParser';

/**
 * B204 — продукт спрашивает у площадки её собственные правила обхода.
 *
 * Разбор `robots.txt` существовал с первого среза, но никто его не звал: право
 * площадки приходило из статического реестра, а `Crawl-delay` — «опрашивать в
 * темпе самой площадки» — не приходил ниоткуда. Ответ кэшируется по хосту:
 * 168 досок работодателей живут на пяти адресах, и спрашивать один и тот же
 * `robots.txt` двести раз — ровно та невежливость, против которой тикет.
 */
export interface RobotsFetchResult {
  readonly status: number;
  readonly body: string | null;
}

export type RobotsFetcher = (robotsUrl: string) => Promise<RobotsFetchResult>;

export interface RobotsPolicy {
  readonly verdict: RobotsVerdictStatus;
  readonly crawlDelaySeconds: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Пока правило не прочитано, площадка не запрещена и не разрешена. */
const UNCONFIRMED: RobotsPolicy = { verdict: 'unconfirmed', crawlDelaySeconds: null };

export class RobotsPolicyLoader {
  private readonly fetchRobots: RobotsFetcher;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { answer: RobotsFetchResult; readAtMs: number }>();
  private readonly inFlight = new Map<string, Promise<RobotsFetchResult>>();

  constructor(options: { fetchRobots: RobotsFetcher; ttlMs?: number }) {
    this.fetchRobots = options.fetchRobots;
    this.ttlMs = options.ttlMs ?? DAY_MS;
  }

  public async policyFor(targetUrl: string, nowMs: number = Date.now()): Promise<RobotsPolicy> {
    const target = parseUrl(targetUrl);
    if (!target) return UNCONFIRMED;

    const answer = await this.answerFor(target.origin, nowMs);
    if (!answer) return UNCONFIRMED;

    // Правило читается под тот путь, который продукт собирается запросить:
    // `Disallow: /embed/` у Greenhouse не запрещает ленту `/v1/boards/…`.
    const verdict = evaluateRobotsPolicy({
      robotsTxtContent: answer.body,
      httpStatus: answer.status,
      path: `${target.pathname}${target.search}`,
    });
    return { verdict: verdict.verdict, crawlDelaySeconds: verdict.crawlDelaySeconds };
  }

  private async answerFor(origin: string, nowMs: number): Promise<RobotsFetchResult | null> {
    const cached = this.cache.get(origin);
    if (cached && nowMs - cached.readAtMs < this.ttlMs) return cached.answer;

    const pending = this.inFlight.get(origin);
    if (pending) return pending;

    const request = this.read(origin, nowMs);
    this.inFlight.set(origin, request);
    try {
      const answer = await request;
      // Недоступный `robots.txt` — не разрешение и не запрет: молчание сети
      // нельзя выдать ни за право, ни за отказ площадки.
      return answer.status === 0 ? null : answer;
    } finally {
      this.inFlight.delete(origin);
    }
  }

  private async read(origin: string, nowMs: number): Promise<RobotsFetchResult> {
    let answer: RobotsFetchResult;
    try {
      answer = await this.fetchRobots(`${origin}/robots.txt`);
    } catch {
      answer = { status: 0, body: null };
    }
    this.cache.set(origin, { answer, readAtMs: nowMs });
    return answer;
  }
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
