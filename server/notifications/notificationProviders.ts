import type {
  EmailNotificationInput,
  NotificationDeliveryResult,
  TelegramNotificationInput,
} from './notificationDelivery';

export function buildNotificationEmailSender(
  config: AccountEmailConfig,
  fetchImpl: typeof fetch = fetch,
): (input: EmailNotificationInput) => Promise<NotificationDeliveryResult> {
  return async (input) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'openqareer/1.0',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        headers: { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` },
      }),
    });
    if (!response.ok) throw new Error('notification_email_provider_rejected');
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { providerId: typeof body?.id === 'string' ? body.id.slice(0, 160) : null };
  };
}

export function buildNotificationTelegramSender(
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): (input: TelegramNotificationInput) => Promise<NotificationDeliveryResult> {
  return async (input) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'openqareer/1.0' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) throw new Error('notification_telegram_provider_rejected');
    const body = (await response.json().catch(() => null)) as {
      result?: { message_id?: unknown };
    } | null;
    const messageId = body?.result?.message_id;
    return { providerId: typeof messageId === 'number' ? String(messageId) : null };
  };
}

export function buildTelegramWebhookConfigurator(
  botToken: string,
  publicBaseUrl: string,
  webhookSecret: string,
  fetchImpl: typeof fetch = fetch,
): () => Promise<void> {
  return async () => {
    const webhookUrl = new URL('/api/v1/integrations/telegram/webhook', publicBaseUrl).toString();
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'openqareer/1.0' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message'],
      }),
    });
    const result = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    if (!response.ok || result?.ok !== true) throw new Error('telegram_webhook_setup_failed');
  };
}

export interface AccountEmailConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly publicBaseUrl: string;
}
