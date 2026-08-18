import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminConsole } from './AdminConsole';
import type { AuthUser } from '../coach/coachApi';

const candidate: AuthUser = {
  username: 'candidate.test',
  email: 'candidate@example.com',
  displayName: 'Кандидат',
  role: 'candidate',
  isTest: false,
  candidateId: 'candidate-1',
};

const administrator: AuthUser = {
  ...candidate,
  username: 'admin.test',
  displayName: 'Администратор',
  role: 'admin',
  candidateId: null,
};

describe('AdminConsole', () => {
  it('refuses an anonymous visitor without pretending to load anything', () => {
    const html = renderToStaticMarkup(<AdminConsole session={null} />);

    expect(html).toContain('Нужен вход под учётной записью администратора');
    expect(html).not.toContain('admin-table');
    expect(html).not.toContain('Загружаем список');
  });

  it('tells a signed-in candidate the truth instead of asking them to sign in again', () => {
    const html = renderToStaticMarkup(<AdminConsole session={candidate} />);

    expect(html).toContain('Этот аккаунт не администратор');
    expect(html).not.toContain('admin-table');
  });

  it('waits silently while the session is still being checked', () => {
    const html = renderToStaticMarkup(<AdminConsole sessionPending />);

    expect(html).toContain('Проверяем сессию');
    expect(html).not.toContain('Этот аккаунт не администратор');
  });

  it('opens the directory for an administrator and says what it does not show', () => {
    const html = renderToStaticMarkup(<AdminConsole session={administrator} />);

    expect(html).toContain('Учётные записи');
    expect(html).toContain('Поиск по логину, email или имени');
    // The scope note describes the operator section's capabilities.
    expect(html).toContain('управление ролями, тарифами, блокировками');
  });

  it('never renders candidate workspace chrome on the administrator surface', () => {
    const html = renderToStaticMarkup(<AdminConsole session={administrator} />);

    for (const chrome of ['career-shell', 'career-rail', 'career-mobile-nav', 'Тарифы']) {
      expect(html, `the console leaked "${chrome}"`).not.toContain(chrome);
    }
  });
});
