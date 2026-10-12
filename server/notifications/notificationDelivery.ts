import type {
  ClaimedNotificationDelivery,
  NotificationDeliveryChannel,
  SqliteNotificationRepository,
} from '../data/sqliteNotificationRepository';

export interface EmailNotificationInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly unsubscribeUrl: string;
}

export interface TelegramNotificationInput {
  readonly chatId: string;
  readonly text: string;
}

export interface NotificationDeliveryResult {
  readonly providerId?: string | null;
}

export interface NotificationDeliveryProcessorOptions {
  readonly repository: SqliteNotificationRepository;
  readonly publicBaseUrl: string;
  readonly resolveEmail: (candidateId: string) => Promise<string | null> | string | null;
  readonly createUnsubscribeUrl: (candidateId: string) => Promise<string> | string;
  readonly sendEmail?: (input: EmailNotificationInput) => Promise<NotificationDeliveryResult>;
  readonly sendTelegram?: (input: TelegramNotificationInput) => Promise<NotificationDeliveryResult>;
}

export interface NotificationDeliveryRun {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly skipped: number;
}

export class NotificationDeliveryProcessor {
  constructor(private readonly options: NotificationDeliveryProcessorOptions) {}

  async processDue(now = new Date().toISOString(), limit = 20): Promise<NotificationDeliveryRun> {
    const deliveries = this.options.repository.claimDueDeliveries(now, limit);
    const result = { claimed: deliveries.length, delivered: 0, failed: 0, skipped: 0 };
    for (const delivery of deliveries) await this.processOne(delivery, now, result);
    return result;
  }

  private async processOne(
    delivery: ClaimedNotificationDelivery,
    now: string,
    result: { delivered: number; failed: number; skipped: number },
  ): Promise<void> {
    if (
      !this.options.repository.isDeliveryEnabled(
        delivery.candidateId,
        delivery.channel,
        delivery.notification.kind,
      )
    ) {
      this.skip(delivery, now, result);
      return;
    }
    try {
      const providerId = await this.send(delivery);
      this.options.repository.completeDelivery(
        delivery.candidateId,
        delivery.notificationId,
        delivery.channel,
        providerId,
        now,
      );
      result.delivered += 1;
    } catch (error) {
      if (error instanceof NotificationDeliverySkippedError) {
        this.skip(delivery, now, result);
        return;
      }
      this.options.repository.retryDelivery(
        delivery.candidateId,
        delivery.notificationId,
        delivery.channel,
        'provider_error',
        now,
      );
      result.failed += 1;
    }
  }

  private skip(
    delivery: ClaimedNotificationDelivery,
    now: string,
    result: { skipped: number },
  ): void {
    this.options.repository.skipDelivery(
      delivery.candidateId,
      delivery.notificationId,
      delivery.channel,
      now,
    );
    result.skipped += 1;
  }

  private async send(delivery: ClaimedNotificationDelivery): Promise<string | null> {
    return delivery.channel === 'email' ? this.sendEmail(delivery) : this.sendTelegram(delivery);
  }

  private async sendEmail(delivery: ClaimedNotificationDelivery): Promise<string | null> {
    if (!this.options.sendEmail) throw new NotificationDeliverySkippedError();
    const to = await this.options.resolveEmail(delivery.candidateId);
    if (!to) throw new NotificationDeliverySkippedError();
    const unsubscribeUrl = await this.options.createUnsubscribeUrl(delivery.candidateId);
    const notificationUrl = new URL(
      delivery.notification.action.href,
      this.options.publicBaseUrl,
    ).toString();
    const response = await this.options.sendEmail({
      to,
      subject: 'Уведомление в openqareer',
      text: `${delivery.notification.title}\nОткройте уведомление в аккаунте: ${notificationUrl}\n\nОтписаться от необязательных писем: ${unsubscribeUrl}`,
      idempotencyKey: `notification-email/${delivery.notificationId}`,
      unsubscribeUrl,
    });
    return response.providerId ?? null;
  }

  private async sendTelegram(delivery: ClaimedNotificationDelivery): Promise<string | null> {
    if (!this.options.sendTelegram) throw new NotificationDeliverySkippedError();
    const chatId = this.options.repository.getTelegramChat(delivery.candidateId);
    if (!chatId) throw new NotificationDeliverySkippedError();
    const notificationUrl = new URL(
      delivery.notification.action.href,
      this.options.publicBaseUrl,
    ).toString();
    const response = await this.options.sendTelegram({
      chatId,
      text: `${delivery.notification.title}\n${notificationUrl}`,
    });
    return response.providerId ?? null;
  }
}

class NotificationDeliverySkippedError extends Error {}

export function notificationDeliveryChannel(value: string): NotificationDeliveryChannel | null {
  return value === 'email' || value === 'telegram' ? value : null;
}
