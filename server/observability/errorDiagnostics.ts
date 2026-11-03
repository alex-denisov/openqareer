const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_FRAMES = 5;

const MASKS: readonly (readonly [RegExp, string])[] = [
  [/[^\s@]+@[^\s@]+\.[^\s@]+/gu, '[email]'],
  [/\b[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]{14,}\b|\b[A-Za-z0-9_-]{24,}\b/gu, '[token]'],
  [/\d{6,}/gu, '[number]'],
];

export interface ErrorDiagnostics {
  readonly errorMessage?: string;
  readonly errorStack?: readonly string[];
}

/**
 * Prod 03.11: 104 failed requests were logged as a bare «Error», so the cause (a too deep SQL
 * filter) had to be reproduced by hand. The log now carries the message, masked and capped, and
 * the top frames; no request body or candidate data is added.
 */
export function errorDiagnostics(error: unknown): ErrorDiagnostics {
  if (!(error instanceof Error)) return {};
  const masked = MASKS.reduce((text, [pattern, mask]) => text.replace(pattern, mask), error.message);
  const frames = (error.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, MAX_STACK_FRAMES);
  return {
    errorMessage: masked.slice(0, MAX_MESSAGE_CHARS),
    ...(frames.length > 0 ? { errorStack: frames } : {}),
  };
}
