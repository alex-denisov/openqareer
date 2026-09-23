import { createHash } from 'node:crypto';

/**
 * Cached bytes for a LinkedIn profile photo or employer logo (B265 §4).
 *
 * The signed CDN link LinkedIn hands back expires in roughly three weeks and
 * tells LinkedIn about every render of the candidate's document, so the
 * server downloads once and serves its own bytes from then on. Everything
 * here validates the *source* URL before any network call is made — a wrong
 * host or path never reaches `fetch` at all, which is what keeps this an
 * image cache rather than an SSRF pivot into the server's network.
 */

export type CandidateMediaKind = 'photo' | 'employer_logo';

export interface DownloadedMedia {
  readonly mediaId: string;
  readonly kind: CandidateMediaKind;
  readonly mime: string;
  readonly bytes: Buffer;
}

export interface CandidateMediaRequest {
  readonly kind: CandidateMediaKind;
  readonly sourceUrl: string;
}

/** Matches the subset of `fetch` this module needs, so tests never hit a network. */
export type MediaFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: 'manual' },
) => Promise<{
  readonly status: number;
  readonly type?: string;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const SIZE_CAP_BYTES: Record<CandidateMediaKind, number> = {
  photo: 300 * 1024,
  employer_logo: 100 * 1024,
};

const MAX_MEDIA_PER_CANDIDATE = 40;
const DEFAULT_PER_FILE_BUDGET_MS = 4_000;
const DEFAULT_TOTAL_BUDGET_MS = 8_000;
const MAX_CONCURRENT_DOWNLOADS = 6;

const MAGIC_BYTES: ReadonlyArray<{ mime: string; matches: (bytes: Buffer) => boolean }> = [
  { mime: 'image/jpeg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Whether a source URL may ever be fetched at all: `https:`, host exactly
 * `media.licdn.com`, path under `/dms/image/`. Everything else — a different
 * host, a cloud metadata IP behind a redirect, a different licdn path — is
 * rejected here, before the caller ever considers making a request.
 */
export function isAllowedLicdnMediaUrl(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'media.licdn.com' &&
    url.pathname.startsWith('/dms/image/')
  );
}

/**
 * Stable id for one candidate's cached copy of one media path. Deliberately
 * excludes the query string (`?e=...`), so the expiring signature LinkedIn
 * appends never fragments one logo used by three roles into three rows.
 */
export function mediaIdFor(
  candidateId: string,
  kind: CandidateMediaKind,
  sourceUrl: string,
): string {
  const url = new URL(sourceUrl);
  const stablePath = `${url.origin}${url.pathname}`;
  return createHash('sha256')
    .update(candidateId)
    .update('\0')
    .update(kind)
    .update('\0')
    .update(stablePath)
    .digest('hex')
    .slice(0, 32);
}

function detectMagicMime(bytes: Buffer): string | null {
  return MAGIC_BYTES.find((candidate) => candidate.matches(bytes))?.mime ?? null;
}

async function downloadOne(
  sourceUrl: string,
  kind: CandidateMediaKind,
  fetchImpl: MediaFetch,
  perFileBudgetMs: number,
): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!isAllowedLicdnMediaUrl(sourceUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), perFileBudgetMs);
  try {
    const response = await fetchImpl(sourceUrl, { signal: controller.signal, redirect: 'manual' });
    // `redirect: 'manual'` turns a redirect into an opaque response (status 0,
    // type 'opaqueredirect') instead of following it — that is what stops a
    // licdn redirect to an internal address (classic cloud-metadata SSRF).
    if (response.type === 'opaqueredirect' || response.status < 200 || response.status >= 300) {
      return null;
    }
    const declaredType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!declaredType || !ALLOWED_CONTENT_TYPES.has(declaredType)) return null;
    // Refuse a declared oversized body before buffering it; the post-read
    // check below still covers a missing or lying header.
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > SIZE_CAP_BYTES[kind]) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > SIZE_CAP_BYTES[kind]) return null;
    const actualMime = detectMagicMime(buffer);
    if (!actualMime || actualMime !== declaredType) return null;
    return { mime: actualMime, bytes: buffer };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveCandidateMediaInput {
  readonly candidateId: string;
  readonly items: readonly CandidateMediaRequest[];
  readonly fetchImpl: MediaFetch;
  readonly perFileBudgetMs?: number;
  readonly totalBudgetMs?: number;
}

/**
 * Downloads every unique media URL a structured import references, subject to
 * the parallel/time budget from the architecture (§4): up to six concurrent
 * requests, four seconds per file, eight seconds total. Every failure mode —
 * disallowed host, oversized body, spoofed content-type, timeout, 5xx — comes
 * back as a missing map entry, never a thrown error, so one bad photo can
 * never fail the resume import around it.
 */
export async function resolveCandidateMedia(
  input: ResolveCandidateMediaInput,
): Promise<Map<string, DownloadedMedia>> {
  const perFileBudgetMs = input.perFileBudgetMs ?? DEFAULT_PER_FILE_BUDGET_MS;
  const totalBudgetMs = input.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;

  const byMediaId = new Map<string, CandidateMediaRequest & { mediaId: string }>();
  for (const item of input.items) {
    const mediaId = mediaIdFor(input.candidateId, item.kind, item.sourceUrl);
    if (!byMediaId.has(mediaId)) byMediaId.set(mediaId, { ...item, mediaId });
  }
  const unique = [...byMediaId.values()].slice(0, MAX_MEDIA_PER_CANDIDATE);

  const deadline = Date.now() + totalBudgetMs;
  const downloaded = new Map<string, DownloadedMedia>();
  const bySourceUrl = new Map<string, string>(); // mediaId -> first sourceUrl seen

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const index = cursor;
      cursor += 1;
      const item = unique[index];
      if (Date.now() >= deadline) continue;
      const remaining = Math.max(0, Math.min(perFileBudgetMs, deadline - Date.now()));
      const result = await downloadOne(item.sourceUrl, item.kind, input.fetchImpl, remaining);
      if (!result) continue;
      if (!bySourceUrl.has(item.mediaId)) bySourceUrl.set(item.mediaId, item.sourceUrl);
      downloaded.set(item.mediaId, {
        mediaId: item.mediaId,
        kind: item.kind,
        mime: result.mime,
        bytes: result.bytes,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_DOWNLOADS, unique.length) }, () => worker()),
  );

  // The caller keys results by the *original* source URL of every item
  // (several URLs can share one mediaId), not by mediaId.
  const bySourceResult = new Map<string, DownloadedMedia>();
  for (const item of input.items) {
    const mediaId = mediaIdFor(input.candidateId, item.kind, item.sourceUrl);
    const media = downloaded.get(mediaId);
    if (media) bySourceResult.set(item.sourceUrl, media);
  }
  return bySourceResult;
}
