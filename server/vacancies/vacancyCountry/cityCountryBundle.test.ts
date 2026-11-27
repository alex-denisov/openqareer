import { build } from 'esbuild';
import { expect, it } from 'vitest';

/** Словарь на 0,9 МБ живёт только в обслуживании: веб-процесс его не загружает. */
it('the web server does not bundle the city dictionary', { timeout: 30_000 }, async () => {
  const { metafile } = await build({
    entryPoints: ['server/index.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    metafile: true,
    logLevel: 'silent',
  });
  const files = Object.keys(metafile.inputs);
  expect(files.length).toBeGreaterThan(100);
  expect(files.filter((file) => file.includes('cityCountryData'))).toEqual([]);
});
