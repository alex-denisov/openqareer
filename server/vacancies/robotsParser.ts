/**
 * RFC 9309 compliant robots.txt parser and policy evaluator (B204).
 *
 * Implements:
 * - User-agent group selection (prefers specific agent, falls back to '*')
 * - Path matching with wildcard '*' and end-of-path '$' anchors
 * - Longest-match rule precedence (Allow wins ties)
 * - Crawl-delay directive parsing
 * - HTTP status code handling (§2.3.1)
 */

export interface RobotsDirectives {
  readonly userAgent: string;
  readonly allow: readonly string[];
  readonly disallow: readonly string[];
  readonly crawlDelaySeconds: number | null;
}

export type RobotsVerdictStatus = 'allowed' | 'disallowed' | 'unconfirmed';

export interface RobotsVerdict {
  readonly verdict: RobotsVerdictStatus;
  readonly crawlDelaySeconds: number | null;
  readonly reason: string;
}

interface ParsedGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

function normalizeDirectiveLine(rawLine: string): string {
  const commentIndex = rawLine.indexOf('#');
  const clean = commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine;
  return clean.trim();
}

function parseDirectiveGroups(content: string): ParsedGroup[] {
  const groups: ParsedGroup[] = [];
  let currentGroup: ParsedGroup | null = null;
  const lines = content.split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = normalizeDirectiveLine(line);
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;

    const key = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key === 'user-agent') {
      if (!currentGroup || currentGroup.allow.length > 0 || currentGroup.disallow.length > 0) {
        currentGroup = {
          agents: [value.toLowerCase()],
          allow: [],
          disallow: [],
          crawlDelaySeconds: null,
        };
        groups.push(currentGroup);
      } else {
        currentGroup.agents.push(value.toLowerCase());
      }
    } else if (currentGroup) {
      handleGroupDirective(currentGroup, key, value);
    }
  }

  return groups;
}

function handleGroupDirective(group: ParsedGroup, key: string, value: string): void {
  if (key === 'disallow' && value.length > 0) {
    group.disallow.push(value);
  } else if (key === 'allow' && value.length > 0) {
    group.allow.push(value);
  } else if (key === 'crawl-delay') {
    const delay = Number.parseFloat(value);
    if (!Number.isNaN(delay) && delay >= 0) {
      group.crawlDelaySeconds = delay;
    }
  }
}

export function parseRobotsDirectives(
  content: string,
  targetAgent: string = '*',
): RobotsDirectives {
  const groups = parseDirectiveGroups(content);
  const normalizedTarget = targetAgent.toLowerCase();

  // Find most specific group matching targetAgent, or fallback to '*'
  const specificGroup = groups.find((g) => g.agents.includes(normalizedTarget));
  const fallbackGroup = groups.find((g) => g.agents.includes('*'));
  const group = specificGroup ?? fallbackGroup;

  return {
    userAgent: targetAgent,
    allow: group ? [...group.allow] : [],
    disallow: group ? [...group.disallow] : [],
    crawlDelaySeconds: group ? group.crawlDelaySeconds : null,
  };
}

function patternToRegExp(pattern: string): RegExp {
  let regexStr = '^';
  let hasEndAnchor = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      regexStr += '.*';
    } else if (char === '$' && i === pattern.length - 1) {
      hasEndAnchor = true;
    } else if ('[\\](){}+?^$|.'.includes(char)) {
      regexStr += `\\${char}`;
    } else {
      regexStr += char;
    }
  }

  if (hasEndAnchor) {
    regexStr += '$';
  }
  return new RegExp(regexStr, 'u');
}

function matchRuleLength(path: string, pattern: string): number | null {
  try {
    const reg = patternToRegExp(pattern);
    if (reg.test(path)) {
      return pattern.length;
    }
    return null;
  } catch {
    return null;
  }
}

export function isPathAllowed(
  path: string,
  robotsTxtContent: string,
  targetAgent: string = '*',
): boolean {
  const directives = parseRobotsDirectives(robotsTxtContent, targetAgent);
  const safePath = path.startsWith('/') ? path : `/${path}`;

  let bestMatchLength = -1;
  let bestVerdict: boolean = true;

  // Evaluate Allow rules
  for (const pattern of directives.allow) {
    const len = matchRuleLength(safePath, pattern);
    if (len !== null && len >= bestMatchLength) {
      bestMatchLength = len;
      bestVerdict = true;
    }
  }

  // Evaluate Disallow rules (Allow wins on tie >= len)
  for (const pattern of directives.disallow) {
    const len = matchRuleLength(safePath, pattern);
    if (len !== null && len > bestMatchLength) {
      bestMatchLength = len;
      bestVerdict = false;
    }
  }

  return bestVerdict;
}

export function parseCrawlDelay(
  robotsTxtContent: string,
  targetAgent: string = '*',
): number | null {
  return parseRobotsDirectives(robotsTxtContent, targetAgent).crawlDelaySeconds;
}

export function evaluateRobotsPolicy(options: {
  robotsTxtContent?: string | null;
  httpStatus?: number;
  path?: string;
  userAgent?: string;
}): RobotsVerdict {
  const status = options.httpStatus ?? 200;
  const path = options.path ?? '/';
  const agent = options.userAgent ?? '*';

  // RFC 9309 §2.3.1: 4xx except 429 means no restrictions
  if (status >= 400 && status < 500 && status !== 429) {
    if (status === 403) {
      // 403 on robots.txt in strict crawler mode means disallow all
      return { verdict: 'disallowed', crawlDelaySeconds: null, reason: 'robots_txt_forbidden_403' };
    }
    return {
      verdict: 'allowed',
      crawlDelaySeconds: null,
      reason: `robots_txt_missing_status_${status}`,
    };
  }

  // 5xx Server Error or unreachable -> fail-closed unconfirmed
  if (status >= 500 || options.robotsTxtContent === null) {
    return {
      verdict: 'unconfirmed',
      crawlDelaySeconds: null,
      reason: `robots_txt_unavailable_status_${status}`,
    };
  }

  const content = options.robotsTxtContent ?? '';
  const allowed = isPathAllowed(path, content, agent);
  const delay = parseCrawlDelay(content, agent);

  return {
    verdict: allowed ? 'allowed' : 'disallowed',
    crawlDelaySeconds: delay,
    reason: allowed ? 'path_allowed' : 'path_disallowed_by_robots_txt',
  };
}
