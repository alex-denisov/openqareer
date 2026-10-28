import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxt } from '../shared/aeoSurface';
import { publicPathViolation } from '../shared/seoSlugPolicy';
import {
  assertSitemapUrlPolicy,
  authResourceHints,
  buildSitemap,
  compactCountryFitDocument,
  pageHead,
  pageModuleHints,
  pageStylesheets,
  prerenderShells,
  sitemapUrls,
} from './prerender-career-shell';

const authManifest = {
  'index.html': {
    file: 'assets/app.js',
    dynamicImports: [
      'module-key',
      'landing-key',
      'auth-key',
      'resume-key',
      'relocation-key',
      'docs-key',
      'calc-key',
      'landing-page-key',
    ],
  },
  'landing-page-key': { name: 'LandingPage', file: 'assets/LandingPage.js' },
  'resume-key': {
    name: 'resumeBuilderRoute',
    file: 'assets/resume.js',
    css: ['assets/resume.css'],
  },
  'docs-key': { name: 'publicDocsRoute', file: 'assets/docs.js', css: ['assets/docs.css'] },
  'relocation-key': {
    name: 'relocationRoute',
    file: 'assets/relocation.js',
    css: ['assets/relocation.css'],
  },
  'calc-key': { name: 'salaryCalculatorRoute', file: 'assets/calc.js', css: ['assets/calc.css'] },
  'module-key': { name: 'AuthPages', file: 'assets/AuthPages-from-build.js' },
  'landing-key': {
    name: 'landing',
    file: 'assets/landing-from-build.js',
    css: ['assets/landing-from-build.css'],
  },
  'auth-key': {
    name: 'auth',
    file: 'assets/auth-from-build.js',
    css: ['assets/auth-from-build.css'],
  },
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('production career shell prerender', () => {
  it('escapes separate share copy and defaults other pages to their full description', () => {
    const template =
      '<head><title>old</title><meta name="description" content="old"><meta property="og:description" content="old"><meta name="twitter:description" content="old"></head>';
    const page = {
      path: '/tools/country-fit',
      title: 'Tax',
      description: 'Full & "verified" <description>',
    };
    const defaultHead = pageHead(template, page);
    expect(defaultHead.match(/Full &amp; &quot;verified&quot; &lt;description&gt;/gu)).toHaveLength(
      3,
    );
    const shared = pageHead(template, { ...page, shareDescription: 'Short & "safe" <share>' });
    expect(shared).toContain(
      'name="description" content="Full &amp; &quot;verified&quot; &lt;description&gt;"',
    );
    expect(shared.match(/Short &amp; &quot;safe&quot; &lt;share&gt;/gu)).toHaveLength(2);
    expect(shared).not.toContain('<share>');
  });
  it('places the real indexed landing page in the entry HTML before JavaScript runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    const adminPath = join(directory, 'admin.html');
    writeFileSync(indexPath, '<!doctype html><html><body><div id="root"></div></body></html>');

    await prerenderShells(indexPath, adminPath);

    const html = readFileSync(indexPath, 'utf8');
    expect(html).toContain('id="root" aria-busy="true"');
    // Ссылки лендинга живут до гидратации: `inert` здесь запрещён (PRB-044).
    expect(html).toContain('class="career-bootstrap-shell" data-bootstrap-shell="true">');
    expect(html).not.toContain('data-bootstrap-shell="true" inert');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Вы выбираете работу');
    // B535: pool numbers are server tokens, replaced on every request.
    expect(html).toContain('%%OQ_ACTIVE%%');
    expect(html).toContain('Как это работает');
    expect(readFileSync(join(directory, 'faq.html'), 'utf8')).toContain('Вопросы о поиске работы');
    expect(readFileSync(join(directory, 'support.html'), 'utf8')).toContain('Поддержка openqareer');
    expect(html).toContain('Тарифы');
    expect(html).toContain('Вопросы');
    expect(html).toContain('application/ld+json');
  });

  it('publishes the exact loading auth pages before JavaScript while retaining noindex and the entry bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-auth-prerender-'));
    temporaryDirectories.push(directory);
    const entry = join(directory, 'index.html');
    writeFileSync(
      entry,
      '<!doctype html><html><head><link rel="canonical" href="https://openqareer.com/"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>',
    );
    await prerenderShells(entry, join(directory, 'admin.html'), directory, authManifest);
    expect(readFileSync(entry, 'utf8')).not.toContain('AuthPages-from-build.js');
    for (const [file, title] of [
      ['login.html', 'Вход в кабинет'],
      ['signup.html', 'Создать аккаунт'],
    ]) {
      const html = readFileSync(join(directory, file), 'utf8');
      expect(html).toContain(`<h1>${title}</h1>`);
      // B574: the site header and footer frame the form.
      expect(html).toContain('<div class="ps ps-auth"><header class="ps-top">');
      expect(html).toContain('</header><main class="auth-page-container">');
      expect(html).toContain('<footer class="ps-footer">');
      expect(html).toContain('class="auth-card" inert=""');
      expect(html).toContain('role="status">Загружаем форму…');
      expect(html).toContain('content="noindex, follow"');
      expect(html).toContain('src="/assets/app.js"');
      expect(html).toContain(
        '<link rel="modulepreload" crossorigin href="/assets/AuthPages-from-build.js">',
      );
      expect(html).toContain(
        '<link rel="modulepreload" crossorigin href="/assets/landing-from-build.js">',
      );
      expect(html).toContain(
        '<link rel="modulepreload" crossorigin href="/assets/auth-from-build.js">',
      );
      expect(html.match(/rel="modulepreload"/gu)).toHaveLength(3);
      expect(html).toContain(
        '<link rel="preload" as="style" crossorigin href="/assets/landing-from-build.css">',
      );
      expect(html).toContain(
        '<link rel="preload" as="style" crossorigin href="/assets/auth-from-build.css">',
      );
      const stylesheet = html.match(/href="(\/assets\/auth-first-paint-[a-f0-9]+\.css)"/u)?.[1];
      expect(stylesheet).toBeDefined();
      const styles = readFileSync(join(directory, stylesheet!), 'utf8');
      expect(styles).toContain('.auth-page-container');
      expect(Buffer.byteLength(styles)).toBeLessThanOrEqual(20_000);
      for (const input of html.match(/<input\b[^>]*>/gu) ?? [])
        expect(input).toContain('disabled=""');
      expect(Buffer.byteLength(html)).toBeLessThanOrEqual(20_000);
    }
  });

  it('rejects manifest paths that could escape the same-origin asset or HTML boundary', () => {
    for (const file of [
      'https://example.test/auth.js',
      '//example.test/auth.js',
      'javascript:alert(1)',
      'assets/../auth.js',
      'assets/%2e%2e/auth.js',
      'assets/auth.js?url=external',
      'assets/auth.js" onload="alert(1)',
      'assets/auth.css',
    ]) {
      expect(() =>
        authResourceHints({
          ...authManifest,
          'module-key': { ...authManifest['module-key'], file },
        }),
      ).toThrow('Invalid auth preload asset path');
    }
    expect(() =>
      authResourceHints({
        ...authManifest,
        'auth-key': { name: 'auth', file: 'assets/auth.js', css: ['//example.test/auth.css'] },
      }),
    ).toThrow('Invalid auth preload asset path');
    expect(() =>
      authResourceHints({
        ...authManifest,
        'auth-key': { name: 'auth', file: 'assets/auth.js' },
      }),
    ).toThrow('Missing emitted auth stylesheet');
    expect(() =>
      authResourceHints({ ...authManifest, 'index.html': { file: 'assets/app.js' } }),
    ).toThrow('Missing entry build graph');
  });

  it('links a tool page chunk stylesheet, off the first-paint sheet', () => {
    const manifest = {
      'index.html': { file: 'assets/app.js', dynamicImports: ['page-key'] },
      'page-key': { name: 'resumeBuilderRoute', file: 'assets/r.js', css: ['assets/r-1.css'] },
    };
    expect(pageStylesheets(manifest, 'resumeBuilderRoute')).toBe(
      '<link rel="stylesheet" crossorigin href="/assets/r-1.css">',
    );
    expect(pageStylesheets(undefined, 'resumeBuilderRoute')).toBe('');
    expect(() => pageStylesheets(manifest, 'relocationRoute')).toThrow(
      'Expected one emitted page chunk',
    );
    expect(() =>
      pageStylesheets(
        {
          ...manifest,
          'page-key': { ...manifest['page-key'], css: ['assets/x.css" onload="bad'] },
        },
        'resumeBuilderRoute',
      ),
    ).toThrow('Invalid page stylesheet path');
  });

  it('validates CSS proxy module URLs as JavaScript assets before emitting hints', () => {
    for (const key of ['landing-key', 'auth-key'] as const) {
      for (const file of [
        '//example.test/proxy.js',
        'assets/../proxy.js',
        'assets/proxy.css',
        'assets/proxy.js" onload="bad',
      ]) {
        expect(() =>
          authResourceHints({
            ...authManifest,
            [key]: { ...authManifest[key], file },
          }),
        ).toThrow('Invalid auth preload asset path');
      }
    }
  });

  it('fails closed when the root mount point is missing or already populated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const missingRoot = join(directory, 'missing.html');
    const populatedRoot = join(directory, 'populated.html');
    writeFileSync(missingRoot, '<html><body></body></html>');
    writeFileSync(populatedRoot, '<div id="root"><p>old</p></div>');

    const adminPath = join(directory, 'admin.html');
    await expect(prerenderShells(missingRoot, adminPath)).rejects.toThrow(
      'production root mount point is missing',
    );
    await expect(prerenderShells(populatedRoot, adminPath)).rejects.toThrow(
      'production root mount point is not empty',
    );
  });

  /**
   * B089 — `/admin` used to inherit the workspace prerender, so the console's
   * own visitors watched the candidate cabinet for a measured 5356 ms before
   * React replaced it. The administrator surface now has its own first paint.
   */
  it('gives the administrator console its own first paint, free of workspace chrome', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    const adminPath = join(directory, 'admin.html');
    writeFileSync(indexPath, '<!doctype html><html><body><div id="root"></div></body></html>');

    await prerenderShells(indexPath, adminPath);

    const admin = readFileSync(adminPath, 'utf8');
    expect(admin).toContain('id="root" aria-busy="true"');
    expect(admin).toContain('class="admin-console"');
    expect(admin).toContain('Проверяем сессию');
    for (const chrome of [
      'data-testid="career-shell"',
      'Начните с карьерного вопроса',
      'Возможности',
      'Тарифы',
    ]) {
      expect(admin, `the administrator first paint leaked "${chrome}"`).not.toContain(chrome);
    }
  });

  it('builds both documents from the same untouched entry HTML', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    const adminPath = join(directory, 'admin.html');
    writeFileSync(
      indexPath,
      '<!doctype html><html><head><script type="module" src="/assets/app.js"></script>' +
        '</head><body><div id="root"></div></body></html>',
    );

    await prerenderShells(indexPath, adminPath);

    // Both surfaces must keep the same entry, or one of them boots nothing.
    for (const path of [indexPath, adminPath]) {
      expect(readFileSync(path, 'utf8')).toContain(
        '<script type="module" src="/assets/app.js"></script>',
      );
    }
  });

  /**
   * B209 — витрина для ИИ-поисковиков собирается на сборке из того же
   * источника, что и правовой пакет, а не лежит ручным файлом в `public/`.
   */
  it('publishes the generated AEO surface next to the sitemap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    const adminPath = join(directory, 'admin.html');
    writeFileSync(indexPath, '<!doctype html><html><body><div id="root"></div></body></html>');

    await prerenderShells(indexPath, adminPath);

    expect(readFileSync(join(directory, 'llms.txt'), 'utf8')).toBe(buildLlmsTxt());
    expect(readFileSync(join(directory, 'llms-full.txt'), 'utf8')).toBe(buildLlmsFullTxt());
  });

  /**
   * B209 — правило владельца про адреса без транслита проверяет сборка, а не
   * память агента: страница с транслитом в пути не доедет до продакшена.
   */
  it("refuses to publish a sitemap URL that breaks the owner's URL policy", () => {
    for (const url of sitemapUrls(buildSitemap())) {
      expect(publicPathViolation(new URL(url).pathname)).toBeNull();
    }
    expect(() => assertSitemapUrlPolicy(['https://openqareer.com/vakansii/moskva'])).toThrow(
      /vakansii/u,
    );
  });
});

describe('Country Fit route document budget', () => {
  it('reuses the exact brand asset without dropping copy or whitespace inside text', () => {
    const html =
      '<!-- build note --><header><svg class="brand-lockup-sign" width="26"><path d="M0 0"/></svg></header>\n <p>Две страны и два сценария</p>';
    const compact = compactCountryFitDocument(html);
    expect(compact).toContain('src="/favicon.svg" width="26" height="26" alt=""');
    expect(compact).toContain('<p>Две страны и два сценария</p>');
    expect(compact).not.toContain('build note');
    expect(compact).not.toContain('<svg');
    expect(compactCountryFitDocument('<span>два</span> <span>сценария</span>')).toBe(
      '<span>два</span> <span>сценария</span>',
    );
  });
});

describe('page module hints (B574)', () => {
  const manifest = {
    'index.html': {
      file: 'assets/index-a.js',
      imports: ['_react.js'],
      dynamicImports: ['src/landing.css', 'src/LandingPage.tsx'],
    },
    '_react.js': { file: 'assets/react-a.js' },
    '_Icon.js': { file: 'assets/Icon.es-a.js', imports: ['_react.js'] },
    'src/landing.css': {
      name: 'landing',
      file: 'assets/landing-a.js',
      css: ['assets/landing-a.css'],
    },
    'src/LandingPage.tsx': {
      name: 'LandingPage',
      file: 'assets/LandingPage-a.js',
      imports: ['_react.js', '_Icon.js'],
    },
  };

  it('preloads the page chunk and its own imports, not what the entry already loads', () => {
    const hints = pageModuleHints(manifest, ['landing', 'LandingPage']);
    expect(hints.startsWith('<!--oq-page-hints--><template id="oq-page-hints">')).toBe(true);
    expect(hints.endsWith('<!--/oq-page-hints-->')).toBe(true);
    expect(hints.match(/rel="modulepreload"/gu)).toHaveLength(3);
    expect(hints).toContain('href="/assets/Icon.es-a.js"');
    expect(hints).not.toContain('react-a.js');
    expect(hints).toContain(
      '<link rel="preload" as="style" crossorigin href="/assets/landing-a.css">',
    );
  });

  it('rejects unknown chunks and unsafe paths', () => {
    expect(() => pageModuleHints(manifest, ['Missing'])).toThrow('Expected one emitted page chunk');
    expect(() =>
      pageModuleHints({ ...manifest, '_Icon.js': { file: 'assets/../x.js' } }, ['LandingPage']),
    ).toThrow('Invalid page preload path');
    expect(pageModuleHints(undefined, ['LandingPage'])).toBe('');
  });
});
