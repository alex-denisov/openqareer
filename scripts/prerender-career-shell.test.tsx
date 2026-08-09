import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prerenderCareerShell } from './prerender-career-shell';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('production career shell prerender', () => {
  it('places the real shared shell in the entry HTML before JavaScript runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const indexPath = join(directory, 'index.html');
    writeFileSync(
      indexPath,
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );

    await prerenderCareerShell(indexPath);

    const html = readFileSync(indexPath, 'utf8');
    expect(html).toContain('data-testid="career-shell"');
    expect(html).toContain('id="root" aria-busy="true"');
    expect(html).toContain(
      'class="career-bootstrap-shell" data-bootstrap-shell="true" inert',
    );
    expect(html).not.toContain('style="display:contents"');
    expect(html).not.toContain('id="root" aria-busy="true" inert');
    expect(html).toContain('Начните с карьерного вопроса');
    expect(html).toContain('Можно начать без документов');
    expect(html).not.toContain('Посмотреть демо');
    expect(html).not.toContain('Демо · синтетические данные');
    expect(html).toContain('Сегодня');
    expect(html).toContain('Профиль');
    expect(html).toContain('Карьера');
    expect(html).toContain('Возможности');
    expect(html).toContain('Тарифы');
    expect(html).not.toContain('Загружаем рабочее пространство');
  });

  it('fails closed when the root mount point is missing or already populated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openqareer-prerender-'));
    temporaryDirectories.push(directory);
    const missingRoot = join(directory, 'missing.html');
    const populatedRoot = join(directory, 'populated.html');
    writeFileSync(missingRoot, '<html><body></body></html>');
    writeFileSync(populatedRoot, '<div id="root"><p>old</p></div>');

    await expect(prerenderCareerShell(missingRoot)).rejects.toThrow(
      'production root mount point is missing',
    );
    await expect(prerenderCareerShell(populatedRoot)).rejects.toThrow(
      'production root mount point is not empty',
    );
  });
});
