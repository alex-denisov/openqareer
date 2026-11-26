import { describe, expect, it, vi } from 'vitest';
import { TelegramWebhookSetupError } from './notificationProviders';
import {
  createTelegramWebhookRegistrar,
  webhookFailureDetail,
} from './telegramWebhookRegistration';

const TOKEN = '123456:token-that-never-leaves-this-test';
const URL_WITHOUT_TOKEN = 'https://openqareer.test/api/v1/integrations/telegram/webhook';

function fetchFailed(code: string): TypeError {
  const cause = Object.assign(new Error(`connect ${code} api.telegram.org/bot${TOKEN}`), { code });
  return new TypeError('fetch failed', { cause });
}

function logger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('B732: журнал регистрации вебхука Telegram', () => {
  it('причина сбоя fetch — код из cause, без текста ошибки и токена', () => {
    const detail = webhookFailureDetail(fetchFailed('ECONNRESET'));
    expect(detail).toEqual({ failureType: 'TypeError', causeCode: 'ECONNRESET' });
    expect(JSON.stringify(detail)).not.toContain('token');
  });

  it('отказ Telegram — HTTP-статус, без кода причины', () => {
    expect(webhookFailureDetail(new TelegramWebhookSetupError(401))).toEqual({
      failureType: 'TelegramWebhookSetupError',
      status: 401,
    });
  });

  it('незнакомая ошибка — только её тип', () => {
    expect(webhookFailureDetail('boom')).toEqual({ failureType: 'UnknownError' });
    expect(webhookFailureDetail(new TypeError('x', { cause: { code: 42 } }))).toEqual({
      failureType: 'TypeError',
    });
  });

  it('сбой, затем успех: попытки нумеруются, ready пишет адрес без токена и номер попытки', async () => {
    const log = logger();
    const configure = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(fetchFailed('ENOTFOUND'))
      .mockResolvedValueOnce(undefined);
    const register = createTelegramWebhookRegistrar(configure, log, URL_WITHOUT_TOKEN);

    expect(await register()).toBe(false);
    expect(await register()).toBe(true);
    expect(await register()).toBe(true);

    expect(configure).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(
      {
        code: 'telegram_webhook_setup_failed',
        failureType: 'TypeError',
        causeCode: 'ENOTFOUND',
        attempt: 1,
      },
      'candidate-telegram-webhook-setup-failed',
    );
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { url: URL_WITHOUT_TOKEN, attempt: 2 },
      'telegram-webhook-ready',
    );
    expect(JSON.stringify([log.error.mock.calls, log.info.mock.calls])).not.toContain(TOKEN);
  });

  it('пока идёт попытка, вторая не запускается', async () => {
    let finish: () => void = () => undefined;
    const configure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const register = createTelegramWebhookRegistrar(configure, logger(), URL_WITHOUT_TOKEN);
    const first = register();
    expect(await register()).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(configure).toHaveBeenCalledTimes(1);
  });
});
