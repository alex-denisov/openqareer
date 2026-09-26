import { describe, expect, it, vi } from 'vitest';
import { notifyOwner } from './ownerTelegram';

const config = { telegramBotToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', telegramOwnerChatId: '42' };

describe('notifyOwner (B266)', () => {
  it('does nothing without a token or chat id', async () => {
    const fetchImpl = vi.fn();
    expect(await notifyOwner({}, 'hi', fetchImpl as never)).toEqual({ status: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the text to the owner chat', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
    );
    expect(await notifyOwner(config, 'Новая заявка', fetchImpl as never)).toEqual({
      status: 'sent',
      httpStatus: 200,
      messageId: 42,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendMessage');
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '42', text: 'Новая заявка' });
  });

  it('does not report sent when Telegram rejects or malforms its response', async () => {
    const rejected = vi.fn(async () => new Response('{"ok":false}', { status: 400 }));
    expect(await notifyOwner(config, 'x', rejected as never)).toEqual({
      status: 'failed',
      reason: 'http',
      httpStatus: 400,
    });

    const malformed = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    expect(await notifyOwner(config, 'x', malformed as never)).toEqual({
      status: 'failed',
      reason: 'invalid_response',
      httpStatus: 200,
    });
  });

  it('never throws when Telegram is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await notifyOwner(config, 'x', fetchImpl as never)).toEqual({
      status: 'failed',
      reason: 'network',
    });
  });
});
