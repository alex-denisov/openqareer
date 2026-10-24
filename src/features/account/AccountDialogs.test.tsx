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
});
