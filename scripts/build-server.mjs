import { build } from 'esbuild';
import { SERVER_MINIFY } from './serverMinify.mjs';
import { writeFingerprints } from './maintenanceFingerprint.mjs';

const release = process.env.VITE_OPENQAREER_RELEASE || 'local';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  ...SERVER_MINIFY,
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
// B759: the web build's metafile lists its schema sources for the maintenance fingerprint.
const web = await build({
  ...shared,
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server.mjs',
  metafile: true,
});
await build({ ...shared, entryPoints: ['server/maintenance.ts'], outfile: 'dist/maintenance.mjs' });
// B643: site render runs on its own event loop; maintenance.mjs spawns it from the same directory.
await build({
  ...shared,
  entryPoints: ['server/vacancies/siteRenderWorker.ts'],
  outfile: 'dist/site-render-worker.mjs',
});
// B756: hh.ru fetch (request and body) on its own event loop; maintenance.mjs spawns it.
await build({
  ...shared,
  entryPoints: ['server/vacancies/hhFetchWorker.ts'],
  outfile: 'dist/hh-fetch-worker.mjs',
});
// B645: freehire pages pass in its own thread of the maintenance process.
await build({
  ...shared,
  entryPoints: ['server/companyDirectory/freehire/freehirePagesWorker.ts'],
  outfile: 'dist/freehire-pages-worker.mjs',
});
// B645: the same pass as its own unit (deploy/bootstrap-freehire-pages.sh).
await build({
  ...shared,
  entryPoints: ['server/companyDirectory/freehire/freehirePagesRun.ts'],
  outfile: 'dist/freehire-pages-run.mjs',
});
// B649-3: heavy maintenance reads (landing, salary snapshots, sitemaps) in their own thread.
await build({
  ...shared,
  entryPoints: ['server/maintenance/heavyReads/heavyReadWorker.ts'],
  outfile: 'dist/heavy-read-worker.mjs',
});
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

// B644: freehire repo board catalog, read by the maintenance step at runtime.
await mkdir('dist/data/freehire', { recursive: true });
await copyFile(
  'server/companyDirectory/freehire/data/freehire-boards-2026-09-03.tsv.gz',
  'dist/data/freehire/freehire-boards-2026-09-03.tsv.gz',
);

// B645: employer board pointers from Career Ops (CC BY 4.0, see NOTICE).
await mkdir('dist/data/careerOps', { recursive: true });
for (const name of ['employer-boards.ndjson', 'LICENSE', 'CONTRIBUTIONS.md']) {
  await copyFile(`server/companyDirectory/careerOps/data/${name}`, `dist/data/careerOps/${name}`);
}

// B803: salary slices from stdin into the database, run by hand.
await build({
  ...shared,
  entryPoints: ['server/vacancies/salaryBenchmarks/salaryImportRun.ts'],
  outfile: 'dist/salary-import.mjs',
});

// B759: deploy restarts maintenance and the mechanics worker only when these change.
writeFingerprints('dist', release, web.metafile);
