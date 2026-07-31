import { build } from 'esbuild';

const release = process.env.VITE_OPENQAREER_RELEASE || 'local';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  define: {
    __OPENQAREER_RELEASE__: JSON.stringify(release),
  },
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});
