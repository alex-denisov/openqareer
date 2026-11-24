const FAILURE_MESSAGE_LIMIT = 200;
/** Redaction runs before the cut: a cut first could leave part of a secret too short to match. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN[\s\S]*?(?:-----END[^-]*-----|$)/gu,
  /\b(?:Bearer\s+|assertion=)\S+/giu,
  /\bya29\.\S+/gu,
  /[A-Za-z0-9+/_.=-]{32,}/gu,
];

/** A failure message for the journal, without tokens and keys. */
export function safeMessage(message: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, '[redacted]'),
    message,
  ).slice(0, FAILURE_MESSAGE_LIMIT);
}
