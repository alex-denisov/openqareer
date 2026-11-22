import { describe, expect, it } from 'vitest';
import { createApp, login } from './authRoutesTestSupport';

describe('B754: device names in the account sessions', () => {
  it('B754: auth/me names the device from the user agent, the .app by its origin', async () => {
    const app = await createApp();
    const candidate = await login(app, 'candidate.test', 'candidate-password-for-tests');
    const appAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: candidate.cookie, 'user-agent': appAgent, origin: 'tauri://localhost' },
    });
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie: candidate.cookie, 'user-agent': 'curl/8.7.1' },
    });
    const sessions = account.json().data.sessions as Array<{
      current: boolean;
      deviceLabel: string | null;
    }>;
    expect(sessions.find((session) => session.current)?.deviceLabel).toBe(
      'MacBook · приложение openqareer',
    );
    expect(JSON.stringify(account.json())).not.toContain('AppleWebKit');
  });
});
