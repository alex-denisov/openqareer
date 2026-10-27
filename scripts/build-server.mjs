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

// HTTP, pool maintenance and isolated bounded fit worker share one release artifact.
// Worker activation is a separate release operation.
await build({ ...shared, entryPoints: ['server/index.ts'], outfile: 'dist/server.mjs' });
await build({ ...shared, entryPoints: ['server/maintenance.ts'], outfile: 'dist/maintenance.mjs' });
await build({
  ...shared,
  entryPoints: ['scripts/run-vacancy-mechanics-worker.ts'],
  outfile: 'dist/vacancy-mechanics-worker.mjs',
});

// B567: the resume export embeds these fonts (Cyrillic and ₽); the bundle cannot carry binaries.
const { copyFile, mkdir } = await import('node:fs/promises');
const RESUME_FONTS = [
  'DejaVuSerif.ttf',
  'DejaVuSerif-Bold.ttf',
  'DejaVuSerif-Italic.ttf',
  'DejaVuSans.ttf',
  'DejaVuSans-Bold.ttf',
  'DejaVuSans-Oblique.ttf',
];
await mkdir('dist/fonts/resume', { recursive: true });
for (const font of RESUME_FONTS) {
  await copyFile(`node_modules/dejavu-fonts-ttf/ttf/${font}`, `dist/fonts/resume/${font}`);
}
