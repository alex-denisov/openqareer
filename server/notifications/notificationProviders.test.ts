import { describe, expect, it, vi } from 'vitest';
import {
  buildNotificationEmailSender,
  buildNotificationTelegramSender,
  buildTelegramWebhookConfigurator,
} from './notificationProviders';

describe('notification provider adapters', () => {
  it('sends email with provider idempotency and an unsubscribe header', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    );
    const sender = buildNotificationEmailSender(
      {
        apiKey: 'test-api-key-never-real',
        from: 'notify@example.test',
        publicBaseUrl: 'https://openqareer.test',
      },
      fetchImpl as typeof fetch,
    );

    const result = await sender({
      to: 'candidate@example.test',
      subject: 'Уведомление',
      text: 'Новая информация.',
      idempotencyKey: 'notification-email/notification-1',
      unsubscribeUrl: 'https://openqareer.test/unsubscribe?token=opaque',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { headers: Record<string, string> };
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
      'notification-email/notification-1',
    );
    expect(body.headers['List-Unsubscribe']).toBe(
      '<https://openqareer.test/unsubscribe?token=opaque>',
    );
    expect(result.providerId).toBe('email-1');
  });

  it('posts Telegram text without exposing the bot token in request data', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { message_id: 42 } }), { status: 200 }),
    );
    const sender = buildNotificationTelegramSender(
      '123456:token-that-never-leaves-this-test',
      fetchImpl as typeof fetch,
    );

    const result = await sender({ chatId: '100200', text: 'Есть ответ работодателя.' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendMessage');
    expect(String(init.body)).not.toContain('123456:token-that-never-leaves-this-test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: '100200',
      text: 'Есть ответ работодателя.',
    });
    expect(result.providerId).toBe('42');
  });

  it('sets a secret Telegram webhook for only message updates', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const configure = buildTelegramWebhookConfigurator(
      '123456:token-that-never-leaves-this-test',
      'https://openqareer.test',
      'long-secret-token-which-never-leaves-this-test',
      fetchImpl as typeof fetch,
    );

    await configure();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/setWebhook');
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://openqareer.test/api/v1/integrations/telegram/webhook',
      secret_token: 'long-secret-token-which-never-leaves-this-test',
      allowed_updates: ['message'],
    });
  });
});
