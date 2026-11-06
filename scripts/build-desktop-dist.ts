import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripPageHints } from '../shared/landingStats';

/**
 * B589: the window of the .app never shows the landing, not for one frame.
 * The web build prerenders the landing into `dist/index.html` for search, and
 * the webview would paint it before any script runs. So the .app gets its own
 * folder with an empty root; `dist` itself stays as it was.
 */
export const DESKTOP_DIST = 'dist-desktop';
const DESKTOP_BACKGROUND = '#090d12';

/** Server code, public pages and files only the site needs. */
const SITE_ONLY =
  /^(?:.+\.html|.+\.mjs|llms.*\.txt|robots\.txt|og-cover.*|og|landing|\.vite|health)$/u;
const LANDING_ASSET = /^(?:LandingPage|landing)-[^/]+\.(?:js|css)$/u;
const TEXT_FILE = /\.(?:js|mjs|css|html|json|txt|svg|map)$/u;

/** A landing leak in the bundle stops the build rather than reach the window. */
export const FORBIDDEN_IN_DESKTOP = ['Вы выбираете работу', '%%OQ_'] as const;

export function isDesktopFile(name: string): boolean {
  return name === 'index.html' || !SITE_ONLY.test(name);
}

/** `win32.basename` reads both separators, so this holds on every build machine. */
export function isLandingAsset(path: string): boolean {
  return LANDING_ASSET.test(win32.basename(path));
}

export function desktopIndexHtml(webIndex: string): string {
  const root = /<div id="root"[^]*<\/body>/u;
  if (!root.test(webIndex)) throw new Error('dist/index.html has no root mount point');
  return stripPageHints(webIndex)
    .replace(/<title>[^<]*<\/title>/u, '<title>OpenQareer</title>')
    .replace(root, '<div id="root" aria-busy="true"></div>\n  </body>')
    .replace(
      '</head>',
      `<style>html,body{margin:0;background:${DESKTOP_BACKGROUND}}</style></head>`,
    );
}

export function forbiddenText(text: string): readonly string[] {
  return FORBIDDEN_IN_DESKTOP.filter((needle) => text.includes(needle));
}

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

export async function verifyDesktopDist(directory: string): Promise<void> {
  const leaks: string[] = [];
  for (const path of await filesUnder(directory)) {
    if (!TEXT_FILE.test(path)) continue;
    const found = forbiddenText(await readFile(path, 'utf8'));
    if (found.length) leaks.push(`${path}: ${found.join(', ')}`);
  }
  if (leaks.length) throw new Error(`landing text in the .app bundle:\n${leaks.join('\n')}`);
}

export async function buildDesktopDist(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    if (!isDesktopFile(name) || name === 'index.html') continue;
    await cp(join(source, name), join(target, name), {
      recursive: true,
      filter: async (path) => (await stat(path)).isDirectory() || !isLandingAsset(path),
    });
  }
  await writeFile(
    join(target, 'index.html'),
    desktopIndexHtml(await readFile(join(source, 'index.html'), 'utf8')),
  );
  await verifyDesktopDist(target);
}

const directPath = process.argv[1];
if (directPath && import.meta.url === pathToFileURL(directPath).href) {
  await buildDesktopDist('dist', DESKTOP_DIST);
  process.stdout.write(`desktop bundle written to ${DESKTOP_DIST}\n`);
}
