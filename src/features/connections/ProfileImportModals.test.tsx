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
    expect(html).toContain('github.com/alex-denisov/openqareer/releases');
  });

  it('renders LinkedInConnectModal with fields when open', () => {
    const html = renderToStaticMarkup(
      <LinkedInConnectModal
        isOpen={true}
        onClose={() => undefined}
        onImportSuccess={() => undefined}
        initialUrl="https://www.linkedin.com/in/alexey-denisov"
      />,
    );

    expect(html).toContain('Подключение LinkedIn');
    expect(html).toContain('https://www.linkedin.com/in/alexey-denisov');
    expect(html).toContain('Подключить и импортировать');
  });

  it('renders HhConnectModal with fields and real-time status when open', () => {
    const html = renderToStaticMarkup(
      <HhConnectModal
        isOpen={true}
        onClose={() => undefined}
        onConnectSuccess={() => undefined}
        initialUrl="https://hh.ru/resume/test-resume"
      />,
    );

    expect(html).toContain('Подключение HeadHunter (hh.ru)');
    expect(html).toContain('https://hh.ru/resume/test-resume');
    expect(html).toContain('Подключить');
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
