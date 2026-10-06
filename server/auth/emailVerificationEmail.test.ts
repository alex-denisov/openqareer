import { describe, expect, it, vi } from 'vitest';
import {
  buildEmailVerificationNotifier,
  buildEmailVerificationSender,
  emailVerificationEmailText,
} from './emailVerificationEmail';

describe('email verification message', () => {
  it('does not create a code logger in production without a mail sender', () => {
    const write = vi.fn();
    const sender = buildEmailVerificationSender({
      environment: 'production',
      writeDevelopmentCode: write,
    });

    expect(sender).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it('uses the code logger only for the development fallback', async () => {
    const write = vi.fn();
    const sender = buildEmailVerificationSender({
      environment: 'development',
      writeDevelopmentCode: write,
    });
    await sender?.({
      candidateId: 'candidate-b398',
      email: 'candidate@example.com',
      displayName: null,
      code: '012345',
      expiresAt: '2026-10-06T16:15:00.000Z',
    });

    expect(write).toHaveBeenCalledWith('{"event":"email_verification_dev_code","code":"012345"}\n');
  });

  it('uses the approved Russian message with the six-digit code', () => {
    expect(emailVerificationEmailText('012345')).toBe(
      'Ваш код подтверждения: 012345. Он действует 15 минут. Если это были не вы — просто проигнорируйте письмо.',
    );
  });

  it('sends the code using the configured account email provider', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const send = buildEmailVerificationNotifier({
      apiKey: 'test-resend-key',
      from: 'openqareer <noreply@example.test>',
      fetchImpl: async (url, init) => {
        requestUrl = String(url);
        requestInit = init;
        return new Response(null, { status: 200 });
      },
    });

    await send({
      candidateId: 'candidate-b398',
      email: 'candidate@example.com',
      displayName: null,
      code: '012345',
      expiresAt: '2026-10-06T16:15:00.000Z',
    });

    expect(requestUrl).toBe('https://api.resend.com/emails');
    expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer test-resend-key' });
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload.to).toEqual(['candidate@example.com']);
    expect(payload.text).toBe(emailVerificationEmailText('012345'));
    expect(requestInit?.headers).not.toMatchObject({ 'Idempotency-Key': '012345' });
  });
});
