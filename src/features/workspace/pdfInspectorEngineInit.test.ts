import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

// The engine is handed pre-fetched bytes now that the 4.8 MB `.wasm` arrives in
// parts (PRB-013, B176). If wasm-bindgen ever stops accepting a buffer, PDF
// upload breaks only in the browser — this proves the contract here.
describe('pdf inspector engine initialisation', () => {
  it('instantiates from a buffer instead of fetching the asset itself', async () => {
    const wasmPath = new URL(
      '../../../node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm',
      import.meta.url,
    );
    const bytes = await readFile(wasmPath);
    const module = await import('@firecrawl/pdf-inspector-wasm');

    await module.default({ module_or_path: bytes });

    expect(typeof module.processPdf).toBe('function');
    expect(typeof module.version()).toBe('string');
  }, 30_000);
});
