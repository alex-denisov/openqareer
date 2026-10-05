import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './deps';

/** Файл и манифест кладёт `scripts/publish-desktop-dmg.sh`; сервер их только читает. */
const MANIFEST_NAME = 'desktop-macos.json';
const DMG_PATTERN = /^OpenQareer_[0-9A-Za-z.+-]+_(aarch64|x64)\.dmg$/;

export interface DesktopDownloadInfo {
  version: string;
  sizeBytes: number;
  sha256: string;
  architecture: string;
  signed: false;
  fileName: string;
}

export function downloadsDirectory(databasePath: string): string {
  return join(dirname(databasePath), 'downloads');
}

/** Размер берётся у настоящего файла, версия и сумма — из манифеста; рассогласование = «нет». */
export async function readDesktopDownload(
  directory: string,
): Promise<(DesktopDownloadInfo & { path: string }) | null> {
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, MANIFEST_NAME), 'utf8'),
    ) as Record<string, unknown>;
    const fileName = typeof manifest.fileName === 'string' ? manifest.fileName : '';
    const match = DMG_PATTERN.exec(fileName);
    if (!match || basename(fileName) !== fileName) return null;
    if (typeof manifest.version !== 'string' || typeof manifest.sha256 !== 'string') return null;
    const path = join(directory, fileName);
    const file = await stat(path);
    if (!file.isFile() || file.size === 0) return null;
    return {
      version: manifest.version,
      sizeBytes: file.size,
      sha256: manifest.sha256,
      architecture: match[1],
      signed: false,
      fileName,
      path,
    };
  } catch {
    return null;
  }
}

export function registerDesktopDownloadRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const directory = downloadsDirectory(deps.config.databasePath);

  app.get('/api/v1/desktop/macos', async () => {
    const download = await readDesktopDownload(directory);
    if (!download) return { data: { available: false } };
    const { path: _path, ...info } = download;
    return { data: { available: true, ...info } };
  });

  app.get('/downloads/openqareer-macos.dmg', async (_request, reply) => {
    const download = await readDesktopDownload(directory);
    if (!download) {
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send('Сборка для macOS пока не опубликована.');
    }
    return reply
      .header('Cache-Control', 'no-cache')
      .header('Content-Length', String(download.sizeBytes))
      .header('Content-Disposition', `attachment; filename="${download.fileName}"`)
      .type('application/x-apple-diskimage')
      .send(createReadStream(download.path));
  });
}
