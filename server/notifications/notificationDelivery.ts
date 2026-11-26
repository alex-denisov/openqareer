import type {
  ClaimedNotificationDelivery,
  NotificationDeliveryChannel,
  SqliteNotificationRepository,
} from '../data/sqliteNotificationRepository';
import {
  DEFAULT_DELIVERY_TIME_ZONE,
  digestSlotAfter,
  notificationLine,
  type DeliveryFrequency,
} from './deliverySchedule';

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
  /** n02: компания события (отклик) для строки письма и Telegram; `null` — без компании. */
  readonly resolveCompany?: (
    candidateId: string,
    source: ClaimedNotificationDelivery['source'],
  ) => Promise<string | null> | string | null;
  /** n02: пояс из «Приложения» — по нему 09:00 сводки; без него московский. */
  readonly resolveTimeZone?: (candidateId: string) => Promise<string | null> | string | null;
}

export interface NotificationDeliveryRun {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly skipped: number;
  /** n02: ждут сводки «Раз в день» или «Раз в неделю». */
  readonly deferred: number;
}

type RunCounts = { -readonly [key in keyof NotificationDeliveryRun]: number };

const DIGEST_SUBJECT: Record<Exclude<DeliveryFrequency, 'immediate'>, string> = {
  daily: 'Уведомления openqareer за день',
  weekly: 'Уведомления openqareer за неделю',
};

export class NotificationDeliveryProcessor {
  constructor(private readonly options: NotificationDeliveryProcessorOptions) {}

  async processDue(now = new Date().toISOString(), limit = 20): Promise<NotificationDeliveryRun> {
    const deliveries = this.options.repository.claimDueDeliveries(now, limit);
    const result: RunCounts = { claimed: deliveries.length, delivered: 0, failed: 0, skipped: 0, deferred: 0 };
    const digests = new Map<string, ClaimedNotificationDelivery[]>();
    for (const delivery of deliveries) {
      if (!this.enabled(delivery)) {
        this.skip(delivery, now, result);
        continue;
      }
      const slot = await this.digestSlot(delivery);
      if (slot && now < slot) {
        this.options.repository.deferDelivery(delivery.candidateId, delivery.notificationId, delivery.channel, slot, now);
        result.deferred += 1;
      } else if (slot) {
        const key = `${delivery.candidateId}\u0000${delivery.channel}`;
        digests.set(key, [...(digests.get(key) ?? []), delivery]);
      } else {
        await this.deliver([delivery], now, result);
      }
    }
    for (const group of digests.values()) await this.deliver(group, now, result);
    return result;
  }

  private enabled(delivery: ClaimedNotificationDelivery): boolean {
    return this.options.repository.isDeliveryEnabled(
      delivery.candidateId,
      delivery.channel,
      delivery.notification.kind,
      delivery.notificationId,
    );
  }

  /** Срок сводки по «Как часто»; приглашение и оффер не ждут (B671). */
  private async digestSlot(delivery: ClaimedNotificationDelivery): Promise<string | null> {
    if (delivery.notification.kind === 'employer_reply' && this.options.repository.isInvitation(delivery.notificationId)) {
      return null;
    }
    const { frequency } = this.options.repository.getDeliverySettings(delivery.candidateId);
    if (frequency === 'immediate') return null;
    const zone = (await this.options.resolveTimeZone?.(delivery.candidateId)) ?? DEFAULT_DELIVERY_TIME_ZONE;
    return digestSlotAfter(delivery.notification.createdAt, frequency, zone);
  }

  /** Одно событие — своё письмо; несколько из одной сводки — одно письмо или сообщение. */
  private async deliver(group: readonly ClaimedNotificationDelivery[], now: string, result: RunCounts): Promise<void> {
    try {
      const providerId = await this.send(group);
      for (const delivery of group) {
        this.options.repository.completeDelivery(delivery.candidateId, delivery.notificationId, delivery.channel, providerId, now);
      }
      result.delivered += group.length;
    } catch (error) {
      for (const delivery of group) {
        if (error instanceof NotificationDeliverySkippedError) {
          this.skip(delivery, now, result);
        } else {
          this.options.repository.retryDelivery(delivery.candidateId, delivery.notificationId, delivery.channel, 'provider_error', now);
          result.failed += 1;
        }
      }
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

  private async send(group: readonly ClaimedNotificationDelivery[]): Promise<string | null> {
    const first = group[0]!;
    const settings = this.options.repository.getDeliverySettings(first.candidateId);
    const lines = await Promise.all(
      group.map(async (delivery) =>
        notificationLine(
          delivery.notification.title,
          (await this.options.resolveCompany?.(delivery.candidateId, delivery.source)) ?? null,
          settings.hideCompany,
        ),
      ),
    );
    const single = group.length === 1;
    const href = single ? first.notification.action.href : '/app/notifications';
    const url = new URL(href, this.options.publicBaseUrl).toString();
    const body = single ? lines[0]! : lines.map((line) => `• ${line}`).join('\n');
    const subject =
      single || settings.frequency === 'immediate' ? 'Уведомление в openqareer' : DIGEST_SUBJECT[settings.frequency];
    return first.channel === 'email'
      ? this.sendEmail(first, { subject, body, url, single })
      : this.sendTelegram(first, `${body}\n${url}`);
  }

  private async sendEmail(
    first: ClaimedNotificationDelivery,
    message: { readonly subject: string; readonly body: string; readonly url: string; readonly single: boolean },
  ): Promise<string | null> {
    if (!this.options.sendEmail) throw new NotificationDeliverySkippedError();
    const to = await this.options.resolveEmail(first.candidateId);
    if (!to) throw new NotificationDeliverySkippedError();
    const unsubscribeUrl = await this.options.createUnsubscribeUrl(first.candidateId);
    const open = message.single ? 'Откройте уведомление в аккаунте' : 'Все уведомления';
    const response = await this.options.sendEmail({
      to,
      subject: message.subject,
      text: `${message.body}\n${open}: ${message.url}\n\nОтписаться от необязательных писем: ${unsubscribeUrl}`,
      idempotencyKey: `${message.single ? 'notification-email' : 'notification-email-digest'}/${first.notificationId}`,
      unsubscribeUrl,
    });
    return response.providerId ?? null;
  }

  private async sendTelegram(first: ClaimedNotificationDelivery, text: string): Promise<string | null> {
    if (!this.options.sendTelegram) throw new NotificationDeliverySkippedError();
    const chatId = this.options.repository.getTelegramChat(first.candidateId);
    if (!chatId) throw new NotificationDeliverySkippedError();
    const response = await this.options.sendTelegram({ chatId, text });
    return response.providerId ?? null;
  }
}

class NotificationDeliverySkippedError extends Error {}

export function notificationDeliveryChannel(value: string): NotificationDeliveryChannel | null {
  return value === 'email' || value === 'telegram' ? value : null;
}
