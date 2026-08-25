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
        <strong>
          Импорт LinkedIn и hh.ru доступен только в установленном десктопном приложении
        </strong>
        <p>
          Публичной загрузки приложения пока нет. Получите установочную сборку и
          инструкцию у команды OpenQareer.
        </p>
        <div className="career-web-desktop-actions">
          <span>Если приложение уже установлено, откройте его и выберите «Импорт профиля».</span>
        </div>
      </div>
    </div>
  );
}
