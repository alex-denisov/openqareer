import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AccountSnapshot, AuthUser, CandidateConnection } from '../coach/coachApi';
import {
  CareerAccountView,
  type CareerAccountViewActions,
  type CareerAccountViewProps,
} from './CareerAccountView';

const user: AuthUser = {
  username: 'candidate.test',
  email: 'candidate@example.test',
  displayName: 'Ирина Кандидат',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  emailVerified: true,
};

const account: AccountSnapshot = {
  username: user.username,
  email: user.email,
  displayName: user.displayName,
  profile: {
    headline: null,
    location: null,
    workMode: null,
    timezone: 'Europe/Moscow',
    updatedAt: '2026-10-12T08:00:00.000Z',
  },
  sessions: [
    {
      id: '0123456789abcdef',
      current: true,
      createdAt: '2026-10-10T08:00:00.000Z',
      lastSeenAt: '2026-10-12T08:00:00.000Z',
      expiresAt: '2026-11-10T08:00:00.000Z',
    },
  ],
};

const connections: CandidateConnection[] = [
  {
    platform: 'linkedin',
    available: true,
    capabilities: ['profile_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-10-10T08:00:00.000Z',
    lastImportedAt: '2026-10-12T08:00:00.000Z',
    factCount: 12,
  },
  {
    platform: 'hh',
    available: true,
    capabilities: ['profile_read', 'resume_read'],
    importsCareerHistory: true,
    status: 'disconnected',
  },
];

const actions: CareerAccountViewActions = {
  saveDisplayName: vi.fn(async () => undefined),
  requestEmailChange: vi.fn(async () => null),
  verifyEmailChange: vi.fn(async () => undefined),
  saveTimezone: vi.fn(async () => undefined),
  changePassword: vi.fn(async () => undefined),
  terminateSession: vi.fn(async () => undefined),
  terminateOtherSessions: vi.fn(async () => undefined),
  exportData: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
};

function renderAccount(
  overrides: Partial<CareerAccountViewProps> = {},
) {
  return renderToStaticMarkup(
    <CareerAccountView
      user={user}
      account={account}
      connections={connections}
      loading={false}
      busy={false}
      pendingEmailChange={null}
      initialSection="prof"
      isDesktopApp={false}
      isMobile={false}
      onClose={() => undefined}
      onOpenTariffs={() => undefined}
      actions={actions}
      {...overrides}
    />,
  );
}

describe('CareerAccountView uses account state and the application shell surface', () => {
  it('shows the account tabs available in a browser and hides desktop app settings', () => {
    const html = renderAccount();
    expect(html).toContain('Профиль и вход');
    expect(html).toContain('Подключения');
    expect(html).toContain('Уведомления');
    expect(html).toContain('Согласия и данные');
    expect(html).toContain('Подписка и платежи');
    expect(html).not.toContain('>Приложение</button>');
  });

  it('uses the account response for identity, time zone, and current sessions', () => {
    const html = renderAccount();
    expect(html).toContain('Ирина Кандидат');
    expect(html).toContain('candidate@example.test');
    expect(html).toContain('Europe/Moscow');
    expect(html).toContain('Текущее устройство');
    expect(html).toContain('Эта сессия');
    expect(html).not.toContain('Андрей Лебедев');
  });

  it('uses imported connection facts and avoids invented provider counters', () => {
    const html = renderAccount({ initialSection: 'conn' });
    expect(html).toContain('Импортировано 12 фактов');
    expect(html).toContain('Подключено');
    expect(html).not.toContain('412');
    expect(html).not.toContain('9 из 9');
  });

  it('shows unknown consent records honestly when the account API has not loaded', () => {
    const html = renderAccount({ initialSection: 'cons' });
    expect(html).toContain('Нет проверенных данных');
    expect(html).not.toContain('Дано 03.10');
    expect(html).not.toContain('Дано 05.10');
  });

  it('shows application settings only in the desktop app', () => {
    const appHtml = renderAccount({ initialSection: 'app', isDesktopApp: true });
    const browserHtml = renderAccount({ initialSection: 'app', isDesktopApp: false });
    expect(appHtml).toContain('Приложение');
    expect(appHtml).toMatch(/openqareer \d+\.\d+\.\d+/u);
    expect(appHtml).toContain('Проверить обновления');
    expect(appHtml).not.toContain('пока недоступн');
    expect(appHtml).not.toContain('сборка не помечена');
    expect(browserHtml).not.toContain('>Приложение</button>');
  });

  it('keeps the laid-out functions but drops «unavailable» captions (owner rule 24.10)', () => {
    const pages = [
      renderAccount({ initialSection: 'conn', isDesktopApp: true }),
      renderAccount({ initialSection: 'prof', isDesktopApp: true }),
      renderAccount({ isMobile: true, initialMobileView: 'conn' }),
      renderAccount({ isMobile: true, initialMobileView: 'prof' }),
    ];
    for (const html of pages) expect(html).not.toMatch(/Скоро|Недоступно|пока недоступн/u);
    expect(pages[1]).toContain('Двухфакторная защита');
    expect(pages[1]).toContain('Ключи доступа (passkeys)');
    expect(pages[3]).toContain('Двухфакторная защита');
  });

  it('uses the approved mobile connections layout and keeps app settings out of it', () => {
    const html = renderAccount({ isMobile: true, initialMobileView: 'conn' });
    expect(html).toContain('data-mv="conn"');
    expect(html).toContain('Подключения');
    expect(html).toContain('Импортировано 12 фактов');
    expect(html).not.toContain('data-go="app"');
    expect(html).not.toContain('Приложение openqareer');
  });

  it('shows only connection rows whose action works (owner rule 24.10)', () => {
    const desktop = renderAccount({ initialSection: 'conn', isDesktopApp: true });
    const mobile = renderAccount({ isMobile: true, initialMobileView: 'conn' });
    for (const html of [desktop, mobile]) {
      expect(html).not.toContain('Другие площадки');
      expect(html).not.toContain('Календарь');
    }
    expect(desktop).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Подключить/u);
    expect(desktop).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Уведомления/u);
  });

  it('labels a connect-only platform «Подключено без импорта», not «Импортировано 0 фактов»', () => {
    const connectOnly: CandidateConnection[] = [
      connections[0],
      { ...(connections[0] as Extract<CandidateConnection, { status: 'connected' }>), platform: 'hh', factCount: 0, lastImportedAt: '2026-10-23T08:00:00.000Z' },
    ];
    for (const html of [
      renderAccount({ initialSection: 'conn', connections: connectOnly }),
      renderAccount({ isMobile: true, initialMobileView: 'conn', connections: connectOnly }),
    ]) {
      expect(html).toContain('Подключено без импорта · 23.10');
      expect(html).not.toContain('Импортировано 0 фактов');
    }
  });
});
