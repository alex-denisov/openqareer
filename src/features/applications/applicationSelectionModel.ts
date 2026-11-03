import type {
  ApplicationBulkAction,
  ApplicationBulkResult,
  ApplicationView,
} from './applicationsApi';
import { responseStatusPill, type StatusTone } from './responseCardFace';
import { humanSourceLabel } from './sourceLabels';

/**
 * Mockup 5 `5-selall`: the selection bar names the status when every picked
 * response shares it, and only then shows the status's own actions. The pill
 * label carries a date, so the shared status is compared by tone.
 */
const TONE_LABEL: Record<StatusTone, string> = {
  draft: 'Черновик',
  sent: 'Отправлено',
  ok: 'Доставлено',
  fail: 'Не доставлено',
  reply: 'Ответили',
  interview: 'Интервью',
  offer: 'Оффер',
  closed: 'Закрыто',
};

export interface SharedStatus {
  readonly tone: StatusTone;
  readonly label: string;
}

export function sharedStatus(applications: readonly ApplicationView[]): SharedStatus | null {
  const first = applications[0];
  if (!first) return null;
  const tone = responseStatusPill(first).tone;
  const same = applications.every((application) => responseStatusPill(application).tone === tone);
  return same ? { tone, label: TONE_LABEL[tone] } : null;
}

export function bulkResultNotice(
  action: ApplicationBulkAction,
  result: ApplicationBulkResult,
  labelName?: string,
): string {
  if (action.type === 'retry') {
    return (
      'В очередь подготовлено ' +
      (result.preparedCount ?? 0) +
      '; отправлено ' +
      (result.sentCount ?? 0) +
      '.'
    );
  }
  if (action.type === 'label') {
    return 'Метка «' + (labelName ?? '') + '» добавлена откликам: ' + result.changedCount + '.';
  }
  return 'Закрыто ' + result.changedCount + ' откликов.';
}

/** Why a previewed action has nothing to change, so the bar never offers «Подтвердить: 0». */
export function emptyBulkNotice(action: ApplicationBulkAction): string {
  if (action.type === 'retry') return 'Среди выбранных нет недоставленных откликов.';
  if (action.type === 'label') return 'У всех выбранных откликов эта метка уже есть.';
  return 'Все выбранные отклики уже закрыты.';
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[";\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

function companyOf(application: ApplicationView): string {
  const vacancy = application.vacancy;
  if (vacancy?.companyHidden) return 'Компания скрыта';
  return vacancy?.company ?? '';
}

export function applicationsCsv(applications: readonly ApplicationView[]): string {
  const header = ['Компания', 'Роль', 'Канал', 'Статус', 'Отправлено', 'Срок шага', 'Метки'];
  const rows = applications.map((application) =>
    [
      companyOf(application),
      application.vacancy?.title ?? '',
      humanSourceLabel(application.vacancy?.source),
      responseStatusPill(application).label,
      (application.appliedAt ?? application.createdAt).slice(0, 10),
      (application.followUp?.dueAt ?? application.followUpDueAt ?? '').slice(0, 10),
      (application.labels ?? []).map((label) => label.name).join(', '),
    ]
      .map(csvCell)
      .join(';'),
  );
  return `\uFEFF${[header.join(';'), ...rows].join('\n')}\n`;
}
