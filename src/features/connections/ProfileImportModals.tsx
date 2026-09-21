import { LockSimple } from '@phosphor-icons/react';

/**
 * Barrel for the connector dialogs. Each modal lives in its own file — the
 * combined module had grown past the file-size budget and both dialogs had to
 * be read in full to change one line of either (B148 §11).
 */
export { HhConnectModal } from './HhConnectModal';
export type { HhResumeItem } from './HhConnectModal';
export { LinkedInConnectModal } from './LinkedInConnectModal';

/** Shown on the web, where a platform session cannot be read from the page. */
export function WebDesktopCtaCallout() {
  return (
    <div className="career-web-desktop-cta">
      <div className="career-web-desktop-icon">
        <LockSimple size={28} weight="fill" />
      </div>
      <div className="career-web-desktop-content">
        <strong>Профили на площадках подключаются в приложении для компьютера</strong>
        <p>
          Публичной загрузки приложения пока нет — напишите команде OpenQareer, пришлём
          установочный файл и инструкцию. На сайте можно загрузить резюме файлом.
        </p>
        <div className="career-web-desktop-actions">
          <span>
            Если приложение уже установлено, откройте в нём «Профили на площадках» и
            нажмите «Подключить».
          </span>
        </div>
      </div>
    </div>
  );
}
