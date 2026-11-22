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

  it('login names the session with the device it signed in from', async () => {
    const app = await createApp();
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:3000', 'user-agent': iphone },
      payload: { username: 'candidate.test', password: 'candidate-password-for-tests' },
    });
    const cookie = String(signedIn.headers['set-cookie']).split(';')[0];
    const windows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie, 'user-agent': windows },
    });
    const sessions = account.json().data.sessions as Array<{
      current: boolean;
      deviceLabel: string | null;
    }>;
    expect(sessions.find((session) => session.current)?.deviceLabel).toBe('iPhone · Safari');
  });
});
