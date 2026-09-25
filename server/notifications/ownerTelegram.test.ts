import { describe, expect, it, vi } from 'vitest';
import { notifyOwner } from './ownerTelegram';

const config = { telegramBotToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', telegramOwnerChatId: '42' };

describe('notifyOwner (B266)', () => {
  it('does nothing without a token or chat id', async () => {
    const fetchImpl = vi.fn();
    expect(await notifyOwner({}, 'hi', fetchImpl as never)).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the text to the owner chat', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await notifyOwner(config, 'Новая заявка', fetchImpl as never)).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendMessage');
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '42', text: 'Новая заявка' });
  });

  it('never throws when Telegram is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await notifyOwner(config, 'x', fetchImpl as never)).toBe('failed');
  });
});
