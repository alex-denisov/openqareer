import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  HhConnectModal,
  LinkedInConnectModal,
  WebDesktopCtaCallout,
} from './ProfileImportModals';

describe('ProfileImportModals', () => {
  it('states the manual pilot-install boundary without advertising a public download', () => {
    const html = renderToStaticMarkup(<WebDesktopCtaCallout />);

    expect(html).toContain('Импорт LinkedIn и hh.ru доступен только в установленном десктопном приложении');
    expect(html).toContain('Публичной загрузки приложения пока нет');
    expect(html).toContain('у владельца пилота');
    for (const unsupportedDownloadClaim of [
      '<a',
      'href=',
      'openqareer.com',
      'Скачать OpenQareer Desktop',
      'macOS',
      'Windows',
      'без риска блокировок',
    ]) {
      expect(html).not.toContain(unsupportedDownloadClaim);
    }
  });

  it('renders HhConnectModal when open', () => {
    const html = renderToStaticMarkup(
      <HhConnectModal
        isOpen={true}
        onClose={() => undefined}
        onConnectSuccess={() => undefined}
        onAuthenticatedEmpty={() => undefined}
        onConnectionFailure={() => undefined}
      />,
    );

    expect(html).toContain('Подключение hh.ru');
    expect(html).toContain('Открыть окно входа в hh.ru');
  });

  it('returns null when the hh.ru modal is closed', () => {
    const hhHtml = renderToStaticMarkup(
      <HhConnectModal
        isOpen={false}
        onClose={() => undefined}
        onConnectSuccess={() => undefined}
        onAuthenticatedEmpty={() => undefined}
        onConnectionFailure={() => undefined}
      />,
    );
    expect(hhHtml).toBe('');
  });

  it('renders the restored LinkedIn session connector without claiming login is enough', () => {
    const html = renderToStaticMarkup(
      <LinkedInConnectModal
        isOpen
        onClose={() => undefined}
        onImportSuccess={() => undefined}
        onConnectionFailure={() => undefined}
      />,
    );

    expect(html).toContain('Подключение LinkedIn');
    expect(html).toContain('Открыть окно входа в LinkedIn');
    expect(html).toContain('сам загрузит профиль и закроет окно');
    expect(html).not.toContain('Логин и пароль остаются');
  });
});
