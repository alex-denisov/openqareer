import { build } from 'esbuild';

const release = process.env.VITE_OPENQAREER_RELEASE || 'local';

const shared = {
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
  external: ['playwright', 'playwright-core', 'fsevents', 'chromium-bidi'],
};

// Два входа из одного кода: HTTP-сервер и обслуживатель пула (B230). Оба
// лежат в dist и уезжают в релизный tarball одним архивом.
await build({ ...shared, entryPoints: ['server/index.ts'], outfile: 'dist/server.mjs' });
await build({ ...shared, entryPoints: ['server/maintenance.ts'], outfile: 'dist/maintenance.mjs' });
