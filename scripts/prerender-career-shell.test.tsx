import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prerenderShells } from './prerender-career-shell';

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
    expect(html).toContain(
      'class="career-bootstrap-shell" data-bootstrap-shell="true" inert',
    );
    expect(html).toContain('Карьерная операционная система кандидата');
    expect(html).toContain('Ранний бесплатный пилот');
    expect(html).toContain('Профиль по фактам');
    expect(html).toContain('Один следующий шаг');
    expect(html).toContain('Условия текущего пилота');
    expect(html).toContain('FAQ');
    expect(html).toContain('application/ld+json');
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
});
