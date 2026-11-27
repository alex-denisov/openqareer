import { TelegramWebhookSetupError } from './notificationProviders';

/**
 * B732: регистрация вебхука Telegram с журналом. Успех пишет адрес вебхука без токена и
 * номер попытки; сбой — тип ошибки, код причины (`ENOTFOUND`, `ECONNRESET`) или
 * HTTP-статус ответа. Текст ошибки не пишется: в нём бывает адрес с токеном бота.
 */
export interface WebhookFailureDetail {
  readonly failureType: string;
  readonly causeCode?: string;
  readonly status?: number;
}

export interface WebhookRegistrationLog {
  info(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;

function causeCodeOf(error: Error): string | undefined {
  const cause = (error as { cause?: unknown }).cause;
  const code =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined;
}

export function webhookFailureDetail(error: unknown): WebhookFailureDetail {
  if (!(error instanceof Error)) return { failureType: 'UnknownError' };
  if (error instanceof TelegramWebhookSetupError) {
    return { failureType: error.name, status: error.status };
  }
  const causeCode = causeCodeOf(error);
  return causeCode ? { failureType: error.name, causeCode } : { failureType: error.name };
}

/** Возвращает `true`, когда вебхук стоит; после успеха Telegram больше не вызывается. */
export function createTelegramWebhookRegistrar(
  configure: () => Promise<void>,
  log: WebhookRegistrationLog,
  webhookUrl: string,
): () => Promise<boolean> {
  let ready = false;
  let configuring = false;
  let attempt = 0;
  return async () => {
    if (ready) return true;
    if (configuring) return false;
    configuring = true;
    attempt += 1;
    try {
      await configure();
      ready = true;
      log.info({ url: webhookUrl, attempt }, 'telegram-webhook-ready');
    } catch (error) {
      log.error(
        { code: 'telegram_webhook_setup_failed', ...webhookFailureDetail(error), attempt },
        'candidate-telegram-webhook-setup-failed',
      );
    } finally {
      configuring = false;
    }
    return ready;
  };
}
