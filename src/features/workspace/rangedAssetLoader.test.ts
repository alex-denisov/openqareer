import { describe, expect, it, vi } from 'vitest';
import { fetchAssetInRanges, RANGE_CHUNK_BYTES } from './rangedAssetLoader';

function asBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function rangeResponse(body: Uint8Array, start: number, end: number, total: number): Response {
  return new Response(asBody(body.slice(start, end + 1)), {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Type': 'application/wasm',
    },
  });
}

function syntheticAsset(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = index % 251;
  return bytes;
}

describe('ranged asset loader', () => {
  it('reassembles an asset that no single response may carry', async () => {
    const asset = syntheticAsset(RANGE_CHUNK_BYTES * 3 + 17);
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const header = String(new Headers(init?.headers).get('Range'));
      const [start, end] = /bytes=(\d+)-(\d+)/u.exec(header)!.slice(1).map(Number);
      return rangeResponse(asset, start, Math.min(end, asset.length - 1), asset.length);
    });

    const loaded = await fetchAssetInRanges('/assets/engine.wasm', { fetchImpl });

    expect(new Uint8Array(loaded)).toEqual(asset);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchImpl.mock.calls) {
      const header = String(new Headers(init?.headers).get('Range'));
      const [start, end] = /bytes=(\d+)-(\d+)/u.exec(header)!.slice(1).map(Number);
      expect(end - start + 1).toBeLessThanOrEqual(RANGE_CHUNK_BYTES);
    }
  });

  it('uses a whole-body answer when the host ignores the range request', async () => {
    const asset = syntheticAsset(1_024);
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(asBody(asset), { status: 200 }),
    );

    const loaded = await fetchAssetInRanges('/assets/engine.wasm', { fetchImpl });

    expect(new Uint8Array(loaded)).toEqual(asset);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fails loudly when a part is short, instead of returning a truncated engine', async () => {
    const asset = syntheticAsset(RANGE_CHUNK_BYTES * 2);
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const header = String(new Headers(init?.headers).get('Range'));
      const [start, end] = /bytes=(\d+)-(\d+)/u.exec(header)!.slice(1).map(Number);
      if (start === 0) return rangeResponse(asset, start, end, asset.length);
      // The Russian route stalls mid-body: the part arrives incomplete.
      return new Response(asBody(asset.slice(start, start + 8)), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${asset.length}` },
      });
    });

    await expect(fetchAssetInRanges('/assets/engine.wasm', { fetchImpl })).rejects.toThrow(
      'asset_range_incomplete',
    );
  });

  it('refuses a first answer without a usable total size', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(asBody(new Uint8Array(8)), { status: 206 }),
    );

    await expect(fetchAssetInRanges('/assets/engine.wasm', { fetchImpl })).rejects.toThrow(
      'asset_range_unsupported',
    );
  });
});
