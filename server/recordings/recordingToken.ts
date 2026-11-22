import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const RECORDING_TOKEN_TTL_MS = 3 * 60 * 60 * 1_000;

export function hashRecordingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function issueRecordingToken(now = Date.now()): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashRecordingToken(token),
    expiresAt: new Date(now + RECORDING_TOKEN_TTL_MS).toISOString(),
  };
}

/** Сравнение хешей за постоянное время; токен нужен только пока запись не закончена и не просрочена. */
export function recordingTokenMatches(
  recording: { tokenHash: string; tokenExpiresAt: string; finishedAt: string | null },
  presented: string | undefined,
  now = Date.now(),
): boolean {
  if (!presented || recording.finishedAt) return false;
  const expected = Buffer.from(recording.tokenHash, 'hex');
  const actual = Buffer.from(hashRecordingToken(presented), 'hex');
  const equal = expected.length === actual.length && timingSafeEqual(expected, actual);
  return equal && Date.parse(recording.tokenExpiresAt) > now;
}
