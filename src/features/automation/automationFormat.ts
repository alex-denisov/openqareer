import type { CandidateAutomationQueueStatus } from '../../../server/domain/candidateAutomation';
import type { CandidateAutomationJournalEntry } from '../../../server/candidate/sqliteCandidateAutomationRepository';

export function automationQueueStatusLabel(status: CandidateAutomationQueueStatus): string {
  if (status === 'letter_not_ready') return 'Письмо не готово';
  if (status === 'pending_approval') return 'Ждёт одобрения';
  if (status === 'approved') return 'Одобрено · ожидает отправки';
  if (status === 'removed') return 'Снято с очереди';
  if (status === 'consultant') return 'Передано консультанту';
  if (status === 'sent') return 'Отправка подтверждена';
  if (status === 'attempted') return 'Пробовали отправить';
  return 'Ошибка отправки';
}

export function automationJournalStatusLabel(entry: CandidateAutomationJournalEntry): string {
  if (entry.result === 'delivered' && entry.receiptId && entry.receiptStatus === 'delivered') {
    return 'Доставлено';
  }
  if (entry.result === 'delivered') return 'Нет квитанции доставки';
  if (entry.result === 'removed') return 'Снято с очереди';
  return 'Ошибка · ничего не отправлено';
}

export function automationPlatformLabel(platform: 'hh' | 'linkedin'): string {
  return platform === 'hh' ? 'hh.ru' : 'LinkedIn';
}

export function automationDateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
