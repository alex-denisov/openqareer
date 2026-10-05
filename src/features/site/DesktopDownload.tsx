import React from 'react';
import { AppleLogo, DownloadSimple } from '@phosphor-icons/react';

export interface DesktopDownloadInfo {
  version: string;
  sizeBytes: number;
  architecture: string;
  signed: boolean;
}

export const DESKTOP_DOWNLOAD_PATH = '/downloads/openqareer-macos.dmg';

export function formatMegabytes(sizeBytes: number): string {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Показывает только то, что сервер подтвердил: нет файла — нет и кнопки. */
export function useDesktopDownload(): DesktopDownloadInfo | null {
  const [info, setInfo] = React.useState<DesktopDownloadInfo | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/desktop/macos', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: Partial<DesktopDownloadInfo> & { available?: boolean } } | null) => {
        const data = body?.data;
        if (
          data?.available === true &&
          typeof data.version === 'string' &&
          typeof data.sizeBytes === 'number' &&
          typeof data.architecture === 'string'
        ) {
          setInfo({
            version: data.version,
            sizeBytes: data.sizeBytes,
            architecture: data.architecture,
            signed: data.signed === true,
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return info;
}

export function DesktopDownload() {
  const info = useDesktopDownload();
  if (!info) return null;
  const chip = info.architecture === 'aarch64' ? 'Apple Silicon' : 'Intel';
  return (
    <div className="site-download" data-testid="desktop-download">
      <a className="site-btn is-secondary" href={DESKTOP_DOWNLOAD_PATH} download>
        <AppleLogo size={18} weight="bold" aria-hidden="true" /> Скачать для macOS
        <DownloadSimple size={18} weight="bold" aria-hidden="true" />
      </a>
      <span className="site-download-meta">
        версия <span className="site-download-mono">{info.version}</span>
        {' · '}
        <span className="site-download-mono">{formatMegabytes(info.sizeBytes)}</span>
        {' · '}
        {chip}
      </span>
      {info.signed ? null : (
        <span className="site-download-note">
          Сборка пока без подписи Apple: при первом запуске откройте её через
          контекстное меню «Открыть».
        </span>
      )}
    </div>
  );
}
