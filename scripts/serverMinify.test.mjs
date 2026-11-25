// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { SERVER_MINIFY } from './serverMinify.mjs';

async function bundleWith(unusedCode) {
  const dir = mkdtempSync(join(tmpdir(), 'oq-minify-'));
  try {
    writeFileSync(
      join(dir, 'lib.js'),
      `export function used(first, second) { return first * second + Math.random(); }
       export function unused(x) { ${unusedCode} }`,
    );
    writeFileSync(
      join(dir, 'main.js'),
      `import { used } from './lib.js'; console.log(used(1, 2));`,
    );
    const result = await build({
      entryPoints: [join(dir, 'main.js')],
      bundle: true,
      format: 'esm',
      write: false,
      ...SERVER_MINIFY,
    });
    return result.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('B759: правка вырезанного кода не меняет бандл обслуживания', async () => {
  const before = await bundleWith('return x;');
  const after = await bundleWith(
    'return new Map([[x, "zzzzzzzzzzqqqqqqqqqqwwwwwwwwww"]]).get(zzzz.qqqq.wwww);',
  );
  expect(after).toBe(before);
});

it('keeps Cyrillic as UTF-8 so the release fits the unpack limit', () => {
  expect(SERVER_MINIFY.charset).toBe('utf8');
});
