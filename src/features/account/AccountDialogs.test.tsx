import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountHhModal, AccountLinkedInModal } from './AccountDialogs';

const connection = {
  platform: 'hh' as const,
  available: true,
  status: 'connected' as const,
  accessMode: 'native_session_snapshot' as const,
  capabilities: ['resume_read'] as ['resume_read'],
  importsCareerHistory: true,
  connectedAt: '2026-10-23T08:00:00.000Z',
  lastImportedAt: '2026-10-23T08:00:00.000Z',
  factCount: 0,
};
const handlers = { busy: false, onClose: vi.fn(), onDisconnect: vi.fn(), onReimport: vi.fn() };

describe('connection manage dialogs for a connect-only platform (24.10)', () => {
  it('hh.ru connected next to a LinkedIn profile says so and offers the replacement', () => {
    const html = renderToStaticMarkup(
      <AccountHhModal
        {...handlers}
        connection={connection}
        connectOnly
        onReplaceProfile={vi.fn()}
      />,
    );
    expect(html).toContain('Подключено без импорта');
    expect(html).toContain('Подключить заново');
    expect(html).toContain('Заменить профиль данными с hh.ru');
    expect(html).not.toContain('Частично');
    expect(html).not.toContain('Повторить импорт');
    expect(html).not.toContain('Импортировано 0 фактов');
  });

  it('LinkedIn connected next to an hh.ru profile says so too', () => {
    const html = renderToStaticMarkup(
      <AccountLinkedInModal
        {...handlers}
        connection={{ ...connection, platform: 'linkedin' }}
        connectOnly
        onReplaceProfile={vi.fn()}
      />,
    );
    expect(html).toContain('Подключено без импорта');
    expect(html).toContain('Заменить профиль данными с LinkedIn');
    expect(html).not.toContain('Импортировать заново');
  });

  it('the profile platform keeps its import wording', () => {
    const html = renderToStaticMarkup(
      <AccountHhModal {...handlers} connection={{ ...connection, factCount: 12 }} />,
    );
    expect(html).toContain('Повторить импорт');
    expect(html).not.toContain('Подключено без импорта');
  });

  it('in the browser offers only what works there: no sign-in window, no replace (B464, 24.10)', () => {
    for (const html of [
      renderToStaticMarkup(
        <AccountHhModal busy={false} onClose={vi.fn()} onDisconnect={vi.fn()} connection={connection} connectOnly />,
      ),
      renderToStaticMarkup(
        <AccountLinkedInModal
          busy={false}
          onClose={vi.fn()}
          onDisconnect={vi.fn()}
          connection={{ ...connection, platform: 'linkedin', factCount: 59 }}
        />,
      ),
    ]) {
      expect(html).toContain('Отключить');
      expect(html).not.toContain('Подключить заново');
      expect(html).not.toContain('Импортировать заново');
      expect(html).not.toContain('Заменить профиль');
    }
  });

  it('says how many LinkedIn contacts were read instead of a dead checkbox (29.10)', () => {
    const linkedin = { ...connection, platform: 'linkedin' as const, factCount: 59 };
    const read = renderToStaticMarkup(
      <AccountLinkedInModal
        {...handlers}
        connection={linkedin}
        contacts={{ importedCount: 1888, importedAt: '2026-10-29T14:00:00.000Z' }}
      />,
    );
    expect(read).toContain('Контакты: 1\u00a0888 · обновлены 29.10');
    expect(read).not.toContain('Использовать контакты для маршрутов к компаниям');
    const connectOnly = renderToStaticMarkup(
      <AccountLinkedInModal
        {...handlers}
        connection={linkedin}
        connectOnly
        contacts={{ importedCount: 3, importedAt: '2026-10-29T14:00:00.000Z' }}
      />,
    );
    expect(connectOnly).toContain('Контакты: 3 · обновлены 29.10');
    const notYet = renderToStaticMarkup(
      <AccountLinkedInModal {...handlers} connection={linkedin} contacts={null} />,
    );
    expect(notYet).toContain('Контакты ещё не прочитаны');
  });
});
