/**
 * The Russian route stalls on any response larger than ~20 460 bytes, while a
 * `Range` request of the same asset completes in a quarter of a second
 * (PRB-013, measured on production 2026-08-29). Assets the browser cannot
 * assemble on its own — a `.wasm` engine, a binary — therefore arrive here in
 * parts and are joined before use.
 */

export const RANGE_CHUNK_BYTES = 16_384;

const MAX_PARALLEL_PARTS = 6;

interface RangedFetchOptions {
  fetchImpl?: typeof fetch;
  chunkBytes?: number;
  signal?: AbortSignal;
}

interface FirstPart {
  bytes: Uint8Array;
  total: number | null;
}

function parseTotal(contentRange: string | null): number | null {
  const match = contentRange ? /\/(\d+)\s*$/u.exec(contentRange) : null;
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

async function readPart(
  url: string,
  start: number,
  end: number,
  options: Required<Pick<RangedFetchOptions, 'fetchImpl'>> & { signal?: AbortSignal },
): Promise<Response> {
  const response = await options.fetchImpl(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: options.signal,
  });
  if (response.status !== 206 && response.status !== 200) {
    throw new Error('asset_range_unavailable');
  }
  return response;
}

export async function fetchAssetInRanges(
  url: string,
  options: RangedFetchOptions = {},
): Promise<ArrayBuffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const chunkBytes = options.chunkBytes ?? RANGE_CHUNK_BYTES;
  const signal = options.signal;

  const first = await readPart(url, 0, chunkBytes - 1, { fetchImpl, signal });
  // A host that ignores `Range` answers 200 with the whole body; nothing is
  // left to assemble.
  if (first.status === 200) {
    return first.arrayBuffer();
  }

  const head: FirstPart = {
    bytes: new Uint8Array(await first.arrayBuffer()),
    total: parseTotal(first.headers.get('Content-Range')),
  };
  if (head.total === null) {
    throw new Error('asset_range_unsupported');
  }
  if (head.total <= head.bytes.byteLength) {
    return head.bytes.buffer.slice(0, head.total) as ArrayBuffer;
  }

  const assembled = new Uint8Array(head.total);
  assembled.set(head.bytes, 0);

  const starts: number[] = [];
  for (let start = head.bytes.byteLength; start < head.total; start += chunkBytes) {
    starts.push(start);
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= starts.length) return;
      const start = starts[index];
      const end = Math.min(start + chunkBytes, head.total!) - 1;
      const response = await readPart(url, start, end, { fetchImpl, signal });
      const part = new Uint8Array(await response.arrayBuffer());
      // A short part is a stalled part. Writing it and moving on would hand a
      // truncated engine to WebAssembly, which fails far from the cause.
      if (part.byteLength !== end - start + 1) {
        throw new Error('asset_range_incomplete');
      }
      assembled.set(part, start);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL_PARTS, starts.length) }, () => worker()),
  );

  return assembled.buffer as ArrayBuffer;
}
