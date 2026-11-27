import { vi } from 'vitest';
import type { RobotsFetcher, RobotsFetchResult } from '../../../robotsPolicyLoader';

export interface MockRouteResult {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly error?: Error;
}

export interface MockRoute {
  readonly match: string | RegExp | ((url: string, init?: RequestInit) => boolean);
  readonly respond:
    | MockRouteResult
    | ((url: string, init?: RequestInit) => MockRouteResult | Promise<MockRouteResult>);
}

export interface FetchCallRecord {
  readonly url: string;
  readonly method: string;
}

export interface MockFetchRouter {
  readonly fetch: typeof fetch;
  readonly calls: FetchCallRecord[];
  callsFor(pattern: string | RegExp): number;
  install(): void;
}

function matchesRoute(route: MockRoute, url: string, init?: RequestInit): boolean {
  if (typeof route.match === 'string') return url.includes(route.match);
  if (route.match instanceof RegExp) return route.match.test(url);
  return route.match(url, init);
}

export function buildMockResponse(result: MockRouteResult): Response {
  const status = result.status ?? 200;
  const headers = new Headers(result.headers);
  if (typeof result.body === 'string' || result.body === undefined) {
    return new Response(result.body ?? '', { status, headers });
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(result.body), { status, headers });
}

export function createMockFetchRouter(
  routes: readonly MockRoute[],
  fallback: MockRouteResult = { status: 404, body: { error: 'unmocked_url' } },
): MockFetchRouter {
  const calls: FetchCallRecord[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    const matched = routes.find((route) => matchesRoute(route, url, init));
    const outcome = matched
      ? typeof matched.respond === 'function'
        ? await matched.respond(url, init)
        : matched.respond
      : fallback;
    if (outcome.error) throw outcome.error;
    return buildMockResponse(outcome);
  }) as typeof fetch;

  return {
    fetch: impl,
    calls,
    callsFor: (pattern) =>
      calls.filter((c) => (typeof pattern === 'string' ? c.url.includes(pattern) : pattern.test(c.url))).length,
    install: () => {
      vi.stubGlobal('fetch', impl);
    },
  };
}

export function createSequencedMockSteps(
  steps: readonly MockRouteResult[],
): () => MockRouteResult {
  let index = 0;
  return () => {
    const step = steps[Math.min(index, steps.length - 1)] ?? { status: 500, body: 'exhausted' };
    index += 1;
    return step;
  };
}

export function createSequencedFetcher(
  steps: readonly MockRouteResult[],
): { readonly fetch: typeof fetch; readonly calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const impl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const step = steps[Math.min(index, steps.length - 1)] ?? { status: 500, body: 'exhausted' };
    index += 1;
    if (step.error) throw step.error;
    return buildMockResponse(step);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export function createMockRobotsFetcher(
  byOrigin: Readonly<Record<string, RobotsFetchResult>>,
  defaultResult: RobotsFetchResult = { status: 200, body: 'User-agent: *\nAllow: /\n' },
): RobotsFetcher {
  return async (robotsUrl: string) => {
    const origin = new URL(robotsUrl).origin;
    return byOrigin[origin] ?? defaultResult;
  };
}

export function restoreMockFetch(): void {
  vi.unstubAllGlobals();
}
