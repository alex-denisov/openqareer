import { LockSimple } from '@phosphor-icons/react';

/**
 * Barrel for the connector dialogs. Each modal lives in its own file — the
 * combined module had grown past the file-size budget and both dialogs had to
 * be read in full to change one line of either (B148 §11).
 */
export { LinkedInConnectModal } from './LinkedInConnectModal';
export type { LinkedInConnectModalProps } from './LinkedInConnectModal';
export { HhConnectModal } from './HhConnectModal';
export type { HhConnectModalProps, HhResumeItem } from './HhConnectModal';

/** Shown on the web, where a platform session cannot be read from the page. */
export function WebDesktopCtaCallout() {
  return (
    <div className="career-web-desktop-cta">
      <div className="career-web-desktop-icon">
        <LockSimple size={28} weight="fill" />
      </div>
      <div className="career-web-desktop-content">
        <strong>
          Импорт профилей LinkedIn и hh.ru доступен в десктопном приложении
        </strong>
        <p>
          Для безопасного прямого подключения к hh.ru и защищённого
          туннелирования LinkedIn без риска блокировок используйте OpenQareer
          Desktop для macOS и Windows.
        </p>
        <div className="career-web-desktop-actions">
          <a
            href="https://openqareer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="career-primary-button career-web-desktop-link"
          >
            Скачать OpenQareer Desktop
          </a>
        </div>
      </div>
    </div>
  );
}
