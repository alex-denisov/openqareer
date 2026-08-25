import { describe, expect, it } from 'vitest';
import { isAuthPath } from '../../src/App';
import { buildPasswordResetNotifier } from './passwordResetEmail';

describe('password reset email delivery', () => {
  it('sends an idempotent Resend request with an escaped account recovery link', async () => {
    const requests: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push([input, init]);
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    };
    const notify = buildPasswordResetNotifier({
      apiKey: 're_test_key_that_is_long_enough',
      from: 'openqareer <account@openqareer.com>',
      publicBaseUrl: 'https://openqareer.com',
      fetchImpl,
    });

    await notify({
      email: 'owner@example.com',
      displayName: '<Мария & команда>',
      token: 'oqr_test_token_for_password_reset_12345678901234567890',
    });

    expect(requests).toHaveLength(1);
    const [url, init] = requests[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer re_test_key_that_is_long_enough',
      'Content-Type': 'application/json',
      'User-Agent': 'openqareer/1.0',
    });
    expect(init?.headers).toHaveProperty('Idempotency-Key');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: 'openqareer <account@openqareer.com>',
      to: ['owner@example.com'],
      subject: 'Сброс пароля — openqareer',
    });
    expect(body.html).toContain('&lt;Мария &amp; команда&gt;');
    const link = /href="([^"]+)"/u.exec(body.html);
    expect(link).not.toBeNull();
    const resetUrl = new URL(link![1]!.replaceAll('&amp;', '&'));
    expect(resetUrl.toString()).toBe(
      'https://openqareer.com/reset-password?token=oqr_test_token_for_password_reset_12345678901234567890',
    );
    expect(isAuthPath(resetUrl.pathname)).toBe(true);
  });
});
