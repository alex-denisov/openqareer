import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  HhConnectModal,
  LinkedInConnectModal,
  WebDesktopCtaCallout,
} from './ProfileImportModals';

describe('ProfileImportModals', () => {
  it('renders WebDesktopCtaCallout with CTA download link', () => {
    const html = renderToStaticMarkup(<WebDesktopCtaCallout />);
    expect(html).toContain('Импорт профилей LinkedIn и hh.ru доступен в десктопном приложении');
    expect(html).toContain('Скачать OpenQareer Desktop');
    expect(html).toContain('openqareer.com');
  });

  it('renders LinkedInConnectModal when open', () => {
    const html = renderToStaticMarkup(
      <LinkedInConnectModal
        isOpen={true}
        onClose={() => undefined}
        onImportSuccess={() => undefined}
      />,
    );

    expect(html).toContain('Подключение LinkedIn');
    expect(html).toContain('Открыть окно входа в LinkedIn');
  });

  it('renders HhConnectModal when open', () => {
    const html = renderToStaticMarkup(
      <HhConnectModal
        isOpen={true}
        onClose={() => undefined}
        onConnectSuccess={() => undefined}
      />,
    );

    expect(html).toContain('Подключение hh.ru');
    expect(html).toContain('Открыть окно входа в hh.ru');
  });

  it('returns null when modals are closed', () => {
    const linkedinHtml = renderToStaticMarkup(
      <LinkedInConnectModal
        isOpen={false}
        onClose={() => undefined}
        onImportSuccess={() => undefined}
      />,
    );
    expect(linkedinHtml).toBe('');

    const hhHtml = renderToStaticMarkup(
      <HhConnectModal
        isOpen={false}
        onClose={() => undefined}
        onConnectSuccess={() => undefined}
      />,
    );
    expect(hhHtml).toBe('');
  });
});
