import { describe, expect, it, vi } from 'vitest';
import { buildAppSignInNotifier } from './appSignInEmail';

describe('B755: письмо о входе в приложение', () => {
  it('называет устройство и время по Москве и ведёт в «Вход и безопасность»', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const send = buildAppSignInNotifier({
      apiKey: 'test-key',
      from: 'openqareer <no-reply@example.test>',
      publicBaseUrl: 'https://openqareer.com',
      fetchImpl,
    });
    await send({
      email: 'owner@example.test',
      displayName: 'Анна <b>',
      deviceLabel: 'Приложение openqareer · Mac',
      at: new Date('2026-11-22T22:30:00.000Z'),
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(init.body)) as { to: string[]; subject: string; html: string };
    expect(body.to).toEqual(['owner@example.test']);
    expect(body.subject).toBe('Вход в приложение openqareer');
    expect(body.html).toContain('«Приложение openqareer · Mac»');
    expect(body.html).toContain('23 ноября');
    expect(body.html).toContain('01:30 по Москве');
    expect(body.html).toContain('https://openqareer.com/app/account/security');
    expect(body.html).toContain('Анна &lt;b&gt;');
  });

  it('отказ почты — ошибка с кодом ответа', async () => {
    const send = buildAppSignInNotifier({
      apiKey: 'test-key',
      from: 'no-reply@example.test',
      publicBaseUrl: 'https://openqareer.com',
      fetchImpl: async () => new Response('{}', { status: 500 }),
    });
    await expect(
      send({
        email: 'a@example.test',
        displayName: null,
        deviceLabel: 'Приложение openqareer · Mac',
        at: new Date(),
      }),
    ).rejects.toThrow('status 500');
  });
});
