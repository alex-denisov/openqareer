import React from 'react';

/** Постоянные адреса: сервер всегда отдаёт по ним текущую сборку (B576). */
export const DESKTOP_DOWNLOAD_PATH = '/downloads/openqareer-macos.dmg';
export const WINDOWS_DOWNLOAD_PATH = '/downloads/openqareer-windows.exe';
const RELEASE_PATH = '/api/v1/desktop/release';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

/** Версия есть, только когда сервер подтвердил одну сборку для macOS и Windows. */
export function parseDesktopRelease(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: { available?: unknown; version?: unknown } }).data;
  if (data?.available !== true || typeof data.version !== 'string') return null;
  return VERSION_PATTERN.test(data.version) ? data.version : null;
}

export function useDesktopRelease(): string | null {
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(RELEASE_PATH, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => setVersion(parseDesktopRelease(body)))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return version;
}

export function AppVersionNote({ version }: { readonly version: string | null }) {
  if (!version) return null;
  return (
    <p className="appver">
      Версия <span className="appver-num">{version}</span> · приложение обновляется само
    </p>
  );
}
