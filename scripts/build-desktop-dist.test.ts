import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDesktopDist,
  desktopIndexHtml,
  forbiddenText,
  isDesktopFile,
} from './build-desktop-dist';

const WEB_INDEX = `<!DOCTYPE html><html><head><title>Поиск работы</title>
<!--oq-page-hints--><template id="oq-page-hints"><link rel="modulepreload" href="/assets/LandingPage-a.js"></template><!--/oq-page-hints-->
<script type="module" src="/assets/index-a.js"></script></head>
<body><div id="root" aria-busy="true"><div class="career-bootstrap-shell">
<h1>Вы выбираете работу</h1><b>%%OQ_ACTIVE%%</b></div></div>
</body></html>`;

describe('.app bundle without the landing (B589)', () => {
  const made: string[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

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

  it('builds the folder and drops the landing chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oq-desktop-'));
    made.push(root);
    const source = join(root, 'dist');
    await mkdir(join(source, 'assets'), { recursive: true });
    await writeFile(join(source, 'index.html'), WEB_INDEX);
    await writeFile(join(source, 'server.mjs'), '%%OQ_ACTIVE%%');
    await writeFile(join(source, 'assets', 'index-a.js'), 'app');
    await writeFile(join(source, 'assets', 'LandingPage-a.js'), 'Вы выбираете работу');
    await writeFile(join(source, 'assets', 'landing-a.css'), '.x{}');
    const target = join(root, 'out');
    await buildDesktopDist(source, target);
    expect((await readdir(target)).sort()).toEqual(['assets', 'index.html']);
    expect(await readdir(join(target, 'assets'))).toEqual(['index-a.js']);
    expect(forbiddenText(await readFile(join(target, 'index.html'), 'utf8'))).toEqual([]);
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
