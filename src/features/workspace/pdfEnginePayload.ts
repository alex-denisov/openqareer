import { fetchAssetInRanges } from './rangedAssetLoader';

/**
 * Getting the 4.8 MB PDF engine to a browser on the Russian route is a
 * connection problem, not a bandwidth one. Measured live on production
 * (B176, 2026-08-29): a TCP connection delivers ~20 460 bytes and then stalls,
 * and the route opens ~5.3 connections per second no matter how many the page
 * asks for in parallel. Time is therefore proportional to the number of parts,
 * so the engine travels compressed — 4 814 355 bytes become 2 158 576, and 294
 * parts become 109 — and the assembled result is kept so the price is paid once
 * per browser rather than once per upload.
 */

const ENGINE_CACHE = 'openqareer-pdf-engine-v1';

/** The subset of `Cache` this module needs, so a test can hand in its own. */
export interface EngineCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

interface EngineLoadOptions {
  fetchImpl?: typeof fetch;
  cache?: EngineCache | null;
}

async function openEngineCache(): Promise<EngineCache | null> {
  // Absent in workers without the Cache API, in private modes and in tests.
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(ENGINE_CACHE);
  } catch {
    return null;
  }
}

async function inflate(packed: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const stream = new Response(packed).body?.pipeThrough(new DecompressionStream('gzip'));
    if (!stream) throw new Error('pdf_engine_unpack_failed');
    const bytes = await new Response(stream).arrayBuffer();
    if (bytes.byteLength === 0) throw new Error('pdf_engine_unpack_failed');
    return bytes;
  } catch {
    throw new Error('pdf_engine_unpack_failed');
  }
}

export async function loadPdfEngineBytes(
  assetUrl: string,
  options: EngineLoadOptions = {},
): Promise<ArrayBuffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache === undefined ? await openEngineCache() : options.cache;
  const cacheKey = new URL(assetUrl, 'https://openqareer.invalid/').toString();

  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached.arrayBuffer();

  let bytes: ArrayBuffer;
  const packed = await fetchAssetInRanges(`${assetUrl}.gz`, { fetchImpl }).catch(() => null);
  if (packed) {
    bytes = await inflate(packed);
  } else {
    // No compressed copy published here — the dev server and any host serving
    // the package's own file still work, just with more parts.
    bytes = await fetchAssetInRanges(assetUrl, { fetchImpl });
  }

  await cache?.put(cacheKey, new Response(bytes.slice(0))).catch(() => undefined);
  return bytes;
}
