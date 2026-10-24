import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxt } from '../shared/aeoSurface';
import { publicPathViolation } from '../shared/seoSlugPolicy';
import {
  assertSitemapUrlPolicy,
  buildSitemap,
  compactCountryFitDocument,
  prerenderShells,
  sitemapUrls,
} from './prerender-career-shell';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('production career shell prerender', () => {
  it('places the real indexed landing page in the entry HTML before JavaScript runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    const adminPath = join(directory, 'admin.html');
    writeFileSync(
      indexPath,
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );

    await prerenderShells(indexPath, adminPath);

    const html = readFileSync(indexPath, 'utf8');
    expect(html).toContain('id="root" aria-busy="true"');
    // Ссылки лендинга живут до гидратации: `inert` здесь запрещён (PRB-044).
    expect(html).toContain('class="career-bootstrap-shell" data-bootstrap-shell="true">');
    expect(html).not.toContain('data-bootstrap-shell="true" inert');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Ваш опыт стоит больше');
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
    writeFileSync(entry, '<!doctype html><html><head><link rel="canonical" href="https://openqareer.com/"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>');
    await prerenderShells(entry, join(directory, 'admin.html'));
    for (const [file, title] of [['login.html', 'Вход в кабинет'], ['signup.html', 'Создать аккаунт']]) {
      const html = readFileSync(join(directory, file), 'utf8');
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain('<main class="auth-page-container">');
      expect(html).toContain('class="auth-card" inert=""');
      expect(html).toContain('role="status">Загружаем форму…');
      expect(html).toContain('content="noindex, follow"');
      expect(html).toContain('src="/assets/app.js"');
      const stylesheet = html.match(/href="(\/assets\/auth-first-paint-[a-f0-9]+\.css)"/u)?.[1];
      expect(stylesheet).toBeDefined();
      expect(readFileSync(join(directory, stylesheet!), 'utf8')).toContain('.auth-page-container');
      for (const input of html.match(/<input\b[^>]*>/gu) ?? []) expect(input).toContain('disabled=""');
      expect(Buffer.byteLength(html)).toBeLessThanOrEqual(20_000);
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
    writeFileSync(
      indexPath,
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );

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
    writeFileSync(
      indexPath,
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );

    await prerenderShells(indexPath, adminPath);

    expect(readFileSync(join(directory, 'llms.txt'), 'utf8')).toBe(buildLlmsTxt());
    expect(readFileSync(join(directory, 'llms-full.txt'), 'utf8')).toBe(buildLlmsFullTxt());
  });

  /**
   * B209 — правило владельца про адреса без транслита проверяет сборка, а не
   * память агента: страница с транслитом в пути не доедет до продакшена.
   */
  it('refuses to publish a sitemap URL that breaks the owner\'s URL policy', () => {
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
    const html = '<!-- build note --><header><svg class="brand-lockup-sign" width="26"><path d="M0 0"/></svg></header>\n <p>Две страны и два сценария</p>';
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
