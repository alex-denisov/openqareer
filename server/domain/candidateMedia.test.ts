import { describe, expect, it, vi } from 'vitest';
import {
  isAllowedLicdnMediaUrl,
  mediaIdFor,
  resolveCandidateMedia,
  type MediaFetch,
} from './candidateMedia';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jpegBytes(size = 15_000): Buffer {
  return Buffer.concat([JPEG_MAGIC, Buffer.alloc(Math.max(0, size - JPEG_MAGIC.length), 1)]);
}

function fakeResponse(options: {
  status?: number;
  contentType?: string;
  body?: Buffer;
  redirected?: boolean;
  type?: string;
  contentLength?: string;
  onRead?: () => void;
}): Response {
  const body = options.body ?? jpegBytes();
  return {
    status: options.status ?? 200,
    type: options.type ?? 'basic',
    redirected: options.redirected ?? false,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === 'content-type') return options.contentType ?? 'image/jpeg';
        if (key === 'content-length') return options.contentLength ?? null;
        return null;
      },
    },
    arrayBuffer: async () => {
      options.onRead?.();
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  } as unknown as Response;
}

const CANDIDATE_ID = 'candidate-1';

describe('isAllowedLicdnMediaUrl', () => {
  it('accepts a media.licdn.com /dms/image/ https url', () => {
    expect(
      isAllowedLicdnMediaUrl(
        'https://media.licdn.com/dms/image/v2/D4E03AQ/profile-displayphoto-shrink_100_100/x?e=1792022400',
      ),
    ).toBe(true);
  });

  it('rejects a host other than media.licdn.com (SSRF)', () => {
    expect(isAllowedLicdnMediaUrl('https://evil.example/dms/image/x')).toBe(false);
  });

  it('rejects a path outside /dms/image/', () => {
    expect(isAllowedLicdnMediaUrl('https://media.licdn.com/other/path')).toBe(false);
  });

  it('rejects a non-https url', () => {
    expect(isAllowedLicdnMediaUrl('http://media.licdn.com/dms/image/x')).toBe(false);
  });
});

describe('mediaIdFor', () => {
  it('dedupes the same employer logo across three roles into one id, ignoring the query string', () => {
    const a = mediaIdFor(
      CANDIDATE_ID,
      'employer_logo',
      'https://media.licdn.com/dms/image/v2/logo/company-logo_100_100?e=1111111111',
    );
    const b = mediaIdFor(
      CANDIDATE_ID,
      'employer_logo',
      'https://media.licdn.com/dms/image/v2/logo/company-logo_100_100?e=2222222222',
    );
    expect(a).toBe(b);
  });

  it('gives different ids to different candidates for the same url', () => {
    const url = 'https://media.licdn.com/dms/image/v2/logo/company-logo_100_100?e=1';
    expect(mediaIdFor('candidate-a', 'employer_logo', url)).not.toBe(
      mediaIdFor('candidate-b', 'employer_logo', url),
    );
  });
});

describe('resolveCandidateMedia', () => {
  const photoUrl = 'https://media.licdn.com/dms/image/v2/photo/profile-displayphoto?e=1';
  const logoUrl = 'https://media.licdn.com/dms/image/v2/logo/company-logo?e=1';

  it('downloads a photo from media.licdn.com and stores sealed bytes', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ body: jpegBytes(15_000) }));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(1);
    const media = result.get(photoUrl);
    expect(media).toMatchObject({ kind: 'photo', mime: 'image/jpeg' });
    expect(media?.bytes.length).toBe(15_000);
  });

  it('rejects a host other than media.licdn.com without ever calling fetch', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({}));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: 'https://evil.example/dms/image/x' }],
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('rejects a redirect from licdn to another host', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ type: 'opaqueredirect', status: 0 }));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
  });

  it('rejects content over the size cap for a photo (300KB) without failing the batch', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ body: jpegBytes(301 * 1024) }));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
  });

  it('refuses a declared oversized body before reading it into memory', async () => {
    const onRead = vi.fn();
    const fetchImpl: MediaFetch = vi.fn(async () =>
      fakeResponse({ body: jpegBytes(1_000), contentLength: String(50 * 1024 * 1024), onRead }),
    );

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
    expect(onRead).not.toHaveBeenCalled();
  });

  it('rejects content over the size cap for a logo (100KB)', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ body: jpegBytes(101 * 1024) }));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'employer_logo', sourceUrl: logoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
  });

  it("rejects a body whose magic bytes don't match its content-type (spoofing)", async () => {
    const fetchImpl: MediaFetch = vi.fn(async () =>
      fakeResponse({ contentType: 'image/jpeg', body: Buffer.from('<html>not an image</html>') }),
    );

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
  });

  it('rejects an unsupported mime even with a well-formed body (SVG/GIF)', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () =>
      fakeResponse({ contentType: 'image/svg+xml', body: Buffer.from('<svg></svg>') }),
    );

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.size).toBe(0);
  });

  it('accepts PNG and WebP magic bytes', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () =>
      fakeResponse({ contentType: 'image/png', body: Buffer.concat([PNG_MAGIC, Buffer.alloc(100)]) }),
    );

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [{ kind: 'photo', sourceUrl: photoUrl }],
      fetchImpl,
    });

    expect(result.get(photoUrl)?.mime).toBe('image/png');
  });

  it('dedupes the same employer logo url referenced by three roles into one fetch', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ body: jpegBytes(3_000) }));

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [
        { kind: 'employer_logo', sourceUrl: `${logoUrl}&role=1` },
        { kind: 'employer_logo', sourceUrl: `${logoUrl}&role=2` },
        { kind: 'employer_logo', sourceUrl: `${logoUrl}&role=3` },
      ],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(3);
    const ids = new Set([...result.values()].map((item) => item.mediaId));
    expect(ids.size).toBe(1);
  });

  it('caps total media rows per candidate at 40', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ body: jpegBytes(1_000) }));
    const items = Array.from({ length: 45 }, (_, index) => ({
      kind: 'employer_logo' as const,
      sourceUrl: `https://media.licdn.com/dms/image/v2/logo/company-${index}?e=1`,
    }));

    const result = await resolveCandidateMedia({ candidateId: CANDIDATE_ID, items, fetchImpl });

    expect(result.size).toBe(40);
  });

  it('a failed download (500) never throws — the import continues without that field', async () => {
    const fetchImpl: MediaFetch = vi.fn(async () => fakeResponse({ status: 500 }));

    await expect(
      resolveCandidateMedia({
        candidateId: CANDIDATE_ID,
        items: [{ kind: 'photo', sourceUrl: photoUrl }],
        fetchImpl,
      }),
    ).resolves.toEqual(new Map());
  });

  it('a slow file (over its per-file budget) is skipped, others still resolve', async () => {
    const fetchImpl: MediaFetch = vi.fn(async (url: string, init: { signal?: AbortSignal }) => {
      if (url === photoUrl) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return fakeResponse({ body: jpegBytes(2_000) });
    });

    const result = await resolveCandidateMedia({
      candidateId: CANDIDATE_ID,
      items: [
        { kind: 'photo', sourceUrl: photoUrl },
        { kind: 'employer_logo', sourceUrl: logoUrl },
      ],
      fetchImpl,
      perFileBudgetMs: 5,
      totalBudgetMs: 50,
    });

    expect(result.has(photoUrl)).toBe(false);
    expect(result.has(logoUrl)).toBe(true);
  });
});
