import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDesktopDist,
  desktopIndexHtml,
  forbiddenText,
  isDesktopFile,
  missingBundleFiles,
} from './build-desktop-dist';

const WEB_INDEX = `<!DOCTYPE html><html><head><title>Поиск работы</title>
<!--oq-page-hints--><template id="oq-page-hints"><link rel="modulepreload" href="/assets/LandingPage-a.js"></template><!--/oq-page-hints-->
<script type="module" src="/assets/index-a.js"></script></head>
<body><div id="root" aria-busy="true"><div class="career-bootstrap-shell">
<h1>Вы выбираете работу</h1><b>%%OQ_ACTIVE%%</b></div></div>
</body></html>`;

const CABINET_ENTRY =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/LandingPage-a.js","assets/Shell-a.js","assets/landing-a.css"])))=>i.map(i=>d[i]);app';
const LANDING_CHUNK =
  'const h="Вы выбираете работу";export{h as LANDING_HERO_TITLE,a as LandingPage,r as readEmbeddedLandingStats};';

describe('.app bundle without the landing (B589)', () => {
  const made: string[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function fixture(assets: Readonly<Record<string, string>>) {
    const root = await mkdtemp(join(tmpdir(), 'oq-desktop-'));
    made.push(root);
    const source = join(root, 'dist');
    await mkdir(join(source, 'assets'), { recursive: true });
    await writeFile(join(source, 'index.html'), WEB_INDEX);
    await Promise.all(
      Object.entries(assets).map(([name, text]) => writeFile(join(source, 'assets', name), text)),
    );
    return { source, target: join(root, 'out') };
  }

  it('empties the root and paints the cabinet background before any script', () => {
    const html = desktopIndexHtml(WEB_INDEX);
    expect(html).toContain('<div id="root" aria-busy="true"></div>');
    expect(forbiddenText(html)).toEqual([]);
    expect(html).toContain('background:#090d12');
    expect(html).toContain('<script type="module" src="/assets/index-a.js"></script>');
    expect(html).not.toContain('LandingPage');
    expect(html).toContain('<title>OpenQareer</title>');
  });

  it('refuses a page without a root', () => {
    expect(() => desktopIndexHtml('<html><body></body></html>')).toThrow('root');
  });

  it('leaves site pages and server code out', () => {
    expect(['index.html', 'assets', 'fonts', 'favicon.svg', 'logo.png'].every(isDesktopFile)).toBe(
      true,
    );
    for (const name of ['login.html', 'server.mjs', 'landing', 'og', 'llms.txt', 'robots.txt']) {
      expect(isDesktopFile(name)).toBe(false);
    }
  });

  it('builds the folder without site pages and with an empty landing chunk', async () => {
    const { source, target } = await fixture({
      'index-a.js': CABINET_ENTRY,
      'LandingPage-a.js': LANDING_CHUNK,
      'landing-a.css': '.x{}',
      'landing-k.js': 'export{};',
      'Shell-a.js': 'import"./landing-k.js";',
    });
    await writeFile(join(source, 'server.mjs'), '%%OQ_ACTIVE%%');
    await buildDesktopDist(source, target);
    expect((await readdir(target)).sort()).toEqual(['assets', 'index.html']);
    expect(forbiddenText(await readFile(join(target, 'index.html'), 'utf8'))).toEqual([]);
    const stub = await readFile(join(target, 'assets', 'LandingPage-a.js'), 'utf8');
    expect(forbiddenText(stub)).toEqual([]);
    expect(stub).toContain('as LandingPage');
    expect(stub).toContain('as readEmbeddedLandingStats');
  });

  it('keeps every file the cabinet loads, shared landing styles included', async () => {
    const { source, target } = await fixture({
      'index-a.js': CABINET_ENTRY,
      'LandingPage-a.js': LANDING_CHUNK,
      'landing-a.css': '.x{}',
      'landing-k.js': 'export{};',
      'Shell-a.js': 'import"./landing-k.js";',
    });
    await buildDesktopDist(source, target);
    expect(await missingBundleFiles(target)).toEqual([]);
    expect((await readdir(join(target, 'assets'))).sort()).toEqual([
      'LandingPage-a.js',
      'Shell-a.js',
      'index-a.js',
      'landing-a.css',
      'landing-k.js',
    ]);
  });

  it('stops the build when a file the bundle asks for is gone', async () => {
    const { source, target } = await fixture({
      'index-a.js': CABINET_ENTRY,
      'LandingPage-a.js': LANDING_CHUNK,
      'Shell-a.js': 'import"./landing-k.js";',
    });
    await expect(buildDesktopDist(source, target)).rejects.toThrow('landing-a.css');
    await expect(missingBundleFiles(target)).resolves.toEqual([
      'assets/landing-a.css',
      'assets/landing-k.js',
    ]);
  });

  it('stops the build when landing text reaches a kept file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oq-desktop-'));
    made.push(root);
    const source = join(root, 'dist');
    await mkdir(join(source, 'assets'), { recursive: true });
    await writeFile(join(source, 'index.html'), WEB_INDEX);
    await writeFile(join(source, 'assets', 'index-a.js'), 'const t = `%%OQ_ACTIVE%%`;');
    await expect(buildDesktopDist(source, join(root, 'out'))).rejects.toThrow('index-a.js');
  });
});
