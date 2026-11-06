import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
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
/**
 * The only chunk with landing text. `landing-*` next to it are shared styles the
 * cabinet loads, so they stay. This one stays by name too: `index` lists it among
 * its dynamic imports, so it is emptied rather than removed.
 */
const LANDING_PAGE_CHUNK = /^LandingPage-.+\.js$/u;
const TEXT_FILE = /\.(?:js|mjs|css|html|json|txt|svg|map)$/u;

/** A landing leak in the bundle stops the build rather than reach the window. */
export const FORBIDDEN_IN_DESKTOP = ['Вы выбираете работу', '%%OQ_'] as const;

export function isDesktopFile(name: string): boolean {
  return name === 'index.html' || !SITE_ONLY.test(name);
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

/** The same export names as the chunk, none of its text. */
export function emptyLandingChunk(chunk: string): string {
  const list = /export\s*\{([^}]*)\}\s*;?\s*$/u.exec(chunk)?.[1];
  if (!list) throw new Error('the landing chunk has no export list');
  const names = list.split(',').map((item) =>
    item
      .trim()
      .split(/\s+as\s+/u)
      .at(-1),
  );
  return `const e=()=>null;export{${names.map((name) => `e as ${name}`).join(',')}};\n`;
}

const HTML_ASSET = /(?:src|href)="\/(assets\/[^"]+)"/gu;
const MAP_DEPS = /__vite__mapDeps=[^[]*\[([^\]]*)\]/gu;
const QUOTED = /"([^"]+)"/gu;
const RELATIVE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*"\.\/([^"]+\.js)"/gu;

function chunkReferences(chunk: string, folder: string): readonly string[] {
  const mapped = [...chunk.matchAll(MAP_DEPS)].flatMap((match) =>
    [...(match[1] ?? '').matchAll(QUOTED)].map((item) => item[1] ?? ''),
  );
  const imported = [...chunk.matchAll(RELATIVE_IMPORT)].map((item) => `${folder}/${item[1]}`);
  return [...mapped, ...imported];
}

/** Files `index.html`, `__vite__mapDeps` or an import ask for and the folder lacks. */
export async function missingBundleFiles(directory: string): Promise<readonly string[]> {
  const files = await filesUnder(directory);
  const present = new Set(files.map((path) => relative(directory, path).replaceAll('\\', '/')));
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const asked = [...html.matchAll(HTML_ASSET)].map((match) => match[1] ?? '');
  for (const path of files.filter((file) => file.endsWith('.js'))) {
    const folder = relative(directory, dirname(path)).replaceAll('\\', '/');
    asked.push(...chunkReferences(await readFile(path, 'utf8'), folder));
  }
  return [...new Set(asked)].filter((path) => !present.has(path)).sort();
}

export async function verifyDesktopDist(directory: string): Promise<void> {
  const leaks: string[] = [];
  for (const path of await filesUnder(directory)) {
    if (!TEXT_FILE.test(path)) continue;
    const found = forbiddenText(await readFile(path, 'utf8'));
    if (found.length) leaks.push(`${path}: ${found.join(', ')}`);
  }
  if (leaks.length) throw new Error(`landing text in the .app bundle:\n${leaks.join('\n')}`);
  const missing = await missingBundleFiles(directory);
  if (missing.length) throw new Error(`missing from the .app bundle:\n${missing.join('\n')}`);
}

export async function buildDesktopDist(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    if (!isDesktopFile(name) || name === 'index.html') continue;
    await cp(join(source, name), join(target, name), { recursive: true });
  }
  const assets = join(target, 'assets');
  for (const name of (await readdir(assets)).filter((item) => LANDING_PAGE_CHUNK.test(item))) {
    const path = join(assets, name);
    await writeFile(path, emptyLandingChunk(await readFile(path, 'utf8')));
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
