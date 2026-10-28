import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './deps';

/**
 * Файлы и манифесты кладёт `openqareer-desktop-publish` из пайплайна
 * «Desktop release» (B576): один релиз — одна версия для macOS и Windows.
 * Сервер их только читает. Старые имена `OpenQareer_<v>_<arch>` допустимы,
 * пока первый релиз пайплайна их не заменил.
 */
export type DesktopPlatform = 'macos' | 'windows';

interface DesktopPlatformFiles {
  manifest: string;
  pattern: RegExp;
  route: string;
  contentType: string;
  missing: string;
}

const PLATFORM_FILES: Record<DesktopPlatform, DesktopPlatformFiles> = {
  macos: {
    manifest: 'desktop-macos.json',
    pattern: /^OpenQareer(?:_[0-9A-Za-z.+-]+_(aarch64|x64)|-\d+\.\d+\.\d+-macos-(universal))\.dmg$/,
    route: '/downloads/openqareer-macos.dmg',
    contentType: 'application/x-apple-diskimage',
    missing: 'Сборка для macOS пока не опубликована.',
  },
  windows: {
    manifest: 'desktop-windows.json',
    pattern: /^OpenQareer(?:_[0-9A-Za-z.+-]+_(x64)|-\d+\.\d+\.\d+-windows-(x64))-setup\.exe$/,
    route: '/downloads/openqareer-windows.exe',
    contentType: 'application/vnd.microsoft.portable-executable',
    missing: 'Сборка для Windows пока не опубликована.',
  },
};

export interface DesktopDownloadInfo {
  version: string;
  sizeBytes: number;
  sha256: string;
  architecture: string;
  signed: false;
  fileName: string;
  commit?: string;
}

export interface DesktopRelease {
  version: string;
  commit?: string;
}

/** B359/B576: the updater feed, written by the release pipeline with `latest.json` last. */
const UPDATE_FILE_PATTERN =
  /^(latest\.json|(OpenQareer_[0-9A-Za-z.+-]+_(aarch64|x86_64)\.app\.tar\.gz|OpenQareer-\d+\.\d+\.\d+-(macos-universal\.app\.tar\.gz|windows-x64-setup\.exe))(\.sig)?)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function updateContentType(file: string): string {
  if (file === 'latest.json') return 'application/json; charset=utf-8';
  if (file.endsWith('.sig')) return 'text/plain; charset=utf-8';
  if (file.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  return 'application/gzip';
}

export function updatesDirectory(databasePath: string): string {
  return join(dirname(databasePath), 'desktop');
}

export function downloadsDirectory(databasePath: string): string {
  return join(dirname(databasePath), 'downloads');
}

/** Размер берётся у настоящего файла, версия и сумма — из манифеста; рассогласование = «нет». */
export async function readDesktopDownload(
  directory: string,
  platform: DesktopPlatform = 'macos',
): Promise<(DesktopDownloadInfo & { path: string }) | null> {
  const files = PLATFORM_FILES[platform];
  try {
    const manifest = JSON.parse(await readFile(join(directory, files.manifest), 'utf8')) as Record<
      string,
      unknown
    >;
    const fileName = typeof manifest.fileName === 'string' ? manifest.fileName : '';
    const match = files.pattern.exec(fileName);
    if (!match || basename(fileName) !== fileName) return null;
    if (typeof manifest.version !== 'string' || typeof manifest.sha256 !== 'string') return null;
    const path = join(directory, fileName);
    const file = await stat(path);
    if (!file.isFile() || file.size === 0) return null;
    const commit =
      typeof manifest.commit === 'string' && COMMIT_PATTERN.test(manifest.commit)
        ? manifest.commit
        : undefined;
    return {
      version: manifest.version,
      sizeBytes: file.size,
      sha256: manifest.sha256,
      architecture: match[1] ?? match[2] ?? '',
      signed: false,
      fileName,
      ...(commit ? { commit } : {}),
      path,
    };
  } catch {
    return null;
  }
}

/** Одна версия на всех клиентов: пока macOS и Windows расходятся, версии нет. */
export async function readDesktopRelease(directory: string): Promise<DesktopRelease | null> {
  const [macos, windows] = await Promise.all([
    readDesktopDownload(directory, 'macos'),
    readDesktopDownload(directory, 'windows'),
  ]);
  if (!macos || !windows || macos.version !== windows.version) return null;
  const commit = macos.commit && macos.commit === windows.commit ? macos.commit : undefined;
  return { version: macos.version, ...(commit ? { commit } : {}) };
}

export function registerDesktopDownloadRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const directory = downloadsDirectory(deps.config.databasePath);

  for (const platform of Object.keys(PLATFORM_FILES) as DesktopPlatform[]) {
    app.get(`/api/v1/desktop/${platform}`, async () => {
      const download = await readDesktopDownload(directory, platform);
      if (!download) return { data: { available: false } };
      const { path: _path, ...info } = download;
      return { data: { available: true, ...info } };
    });
  }

  app.get('/api/v1/desktop/release', async (_request, reply) => {
    const release = await readDesktopRelease(directory);
    reply.header('Cache-Control', 'no-cache');
    return { data: release ? { available: true, ...release } : { available: false } };
  });

  const updates = updatesDirectory(deps.config.databasePath);
  app.get<{ Params: { file: string } }>('/desktop/:file', async (request, reply) => {
    const { file } = request.params;
    const info = UPDATE_FILE_PATTERN.test(file)
      ? await stat(join(updates, file)).catch(() => null)
      : null;
    if (!info?.isFile()) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Обновление не найдено.');
    }
    const isManifest = file === 'latest.json';
    return reply
      .header('Cache-Control', isManifest ? 'no-cache' : 'public, max-age=31536000, immutable')
      .header('Content-Length', String(info.size))
      .type(updateContentType(file))
      .send(createReadStream(join(updates, file)));
  });

  registerInstallerRoutes(app, directory);
}

function registerInstallerRoutes(app: FastifyInstance, directory: string): void {
  // The stable address redirects to the versioned file name: Safari names a
  // `download` link after its URL and ignores Content-Disposition.
  for (const [platform, files] of Object.entries(PLATFORM_FILES) as [
    DesktopPlatform,
    DesktopPlatformFiles,
  ][]) {
    app.get(files.route, async (_request, reply) => {
      const download = await readDesktopDownload(directory, platform);
      if (!download) {
        return reply.code(404).type('text/plain; charset=utf-8').send(files.missing);
      }
      return reply
        .header('Cache-Control', 'no-cache')
        .redirect(`/downloads/${encodeURIComponent(download.fileName)}`, 302);
    });
  }

  // Only the currently published installers are served; nothing else in the folder.
  app.get<{ Params: { file: string } }>('/downloads/:file', async (request, reply) => {
    for (const platform of Object.keys(PLATFORM_FILES) as DesktopPlatform[]) {
      const download = await readDesktopDownload(directory, platform);
      if (download?.fileName !== request.params.file) continue;
      return reply
        .header('Cache-Control', 'no-cache')
        .header('Content-Length', String(download.sizeBytes))
        .header('Content-Disposition', `attachment; filename="${download.fileName}"`)
        .type(PLATFORM_FILES[platform].contentType)
        .send(createReadStream(download.path));
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('Файл не найден.');
  });
}
