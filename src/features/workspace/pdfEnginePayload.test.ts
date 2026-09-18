import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { loadPdfEngineBytes } from './pdfEnginePayload';

function asBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function engine(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7) % 251;
  return bytes;
}

function rangeServer(body: Uint8Array, servedPath: string) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (!url.endsWith(servedPath)) return new Response(null, { status: 404 });
    const header = String(new Headers(init?.headers).get('Range'));
    const match = /bytes=(\d+)-(\d+)/u.exec(header);
    if (!match) return new Response(asBody(body), { status: 200 });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), body.length - 1);
    return new Response(asBody(body.slice(start, end + 1)), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${body.length}` },
    });
  });
}

describe('pdf engine payload', () => {
  it('prefers the compressed engine, so the route carries half the connections', async () => {
    const raw = engine(120_000);
    const packed = new Uint8Array(gzipSync(Buffer.from(raw)));
    const fetchImpl = rangeServer(packed, '/engine.wasm.gz');

    const loaded = await loadPdfEngineBytes('/engine.wasm', { fetchImpl });

    expect(new Uint8Array(loaded)).toEqual(raw);
    expect(packed.byteLength).toBeLessThan(raw.byteLength);
    for (const [url] of fetchImpl.mock.calls) {
      expect(String(url)).toContain('/engine.wasm.gz');
    }
  }, 20_000);

  it('falls back to the plain engine where no compressed copy is published', async () => {
    const raw = engine(40_000);
    const fetchImpl = rangeServer(raw, '/engine.wasm');

    const loaded = await loadPdfEngineBytes('/engine.wasm', { fetchImpl });

    expect(new Uint8Array(loaded)).toEqual(raw);
  });

  it('refuses a compressed engine that unpacks to nothing', async () => {
    const fetchImpl = rangeServer(new Uint8Array([1, 2, 3, 4]), '/engine.wasm.gz');

    await expect(loadPdfEngineBytes('/engine.wasm', { fetchImpl })).rejects.toThrow(
      'pdf_engine_unpack_failed',
    );
  });

  it('pays the route only once per browser by keeping the assembled engine', async () => {
    const raw = engine(40_000);
    const fetchImpl = rangeServer(raw, '/engine.wasm');
    const store = new Map<string, Response>();
    const cache = {
      match: async (key: string) => store.get(key),
      put: async (key: string, response: Response) => {
        store.set(key, response);
      },
    };

    const first = await loadPdfEngineBytes('/engine.wasm', { fetchImpl, cache });
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await loadPdfEngineBytes('/engine.wasm', { fetchImpl, cache });

    expect(new Uint8Array(second)).toEqual(new Uint8Array(first));
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });
});
