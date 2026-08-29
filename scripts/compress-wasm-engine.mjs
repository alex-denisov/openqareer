import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Russian route delivers ~20 460 bytes per TCP connection and opens about
 * 5.3 connections a second, so the browser's cost for the PDF engine is the
 * number of parts, not the bandwidth (B176, measured live 2026-08-29).
 * Publishing the engine gzipped next to itself halves that count: 4 814 355
 * bytes become ~2 158 576, 242 parts become ~109. The plain file stays for
 * hosts and dev servers that never learned about the compressed one.
 */
const assets = join('dist', 'assets');
const engines = readdirSync(assets).filter((name) => name.endsWith('.wasm'));

if (engines.length === 0) {
  console.error('compress-wasm-engine: no .wasm asset in dist/assets');
  process.exit(1);
}

for (const engine of engines) {
  const source = join(assets, engine);
  const packed = gzipSync(readFileSync(source), { level: 9 });
  writeFileSync(`${source}.gz`, packed);
  const raw = statSync(source).size;
  console.log(
    `wasm-engine ${engine} raw=${raw} gzip=${packed.byteLength} ` +
      `parts=${Math.ceil(packed.byteLength / 19_900)} (was ${Math.ceil(raw / 19_900)})`,
  );
}
