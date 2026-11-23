import type { ApplicationView } from '../../applications/applicationsApi';
import type { IconName } from '../kit/Icon';
import { actionPath } from '../responses/ResponsesTable';
import { platformOf } from '../responses/model/platform';
import { buildResponseRow, type ResponseRow } from '../responses/model/responseRow';
import { buildNodePath } from '../routes';

export interface ResponseEventAction {
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
}

/** Строка блока «События откликов» (s05b): отклик, который не дошёл до компании. */
export interface ResponseEvent {
  readonly id: string;
  readonly tag: string;
  readonly title: string;
  readonly company: string;
  /** «Руководитель платформы · Нужен вход в hh.ru». */
  readonly why: string;
  readonly openPath: string;
  readonly action: ResponseEventAction;
}

/** Причина недоставки — нет входа на площадку: чинится входом, а не повторной отправкой. */
const LOGIN_NEEDED = /(?:вход|войд|войти|авториз|логин|сесси)/iu;

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function eventAction(application: ApplicationView, row: ResponseRow): ResponseEventAction {
  const platform = platformOf(application.vacancy?.source);
  if (platform.label === 'hh.ru' && LOGIN_NEEDED.test(row.failure ?? '')) {
    return { label: 'Войти в hh.ru', icon: 'out', path: buildNodePath('n03') };
  }
  return {
    label: row.action?.label ?? 'Открыть отклик',
    icon: row.action?.icon ?? 'right',
    path: row.action ? actionPath(row) : buildNodePath('o01c', { responseId: row.id }),
  };
}

function recordedAt(application: ApplicationView): number {
  const time = Date.parse(application.deliveryReceiptRecordedAt ?? '');
  return Number.isNaN(time) ? 0 : time;
}

/**
 * B650 s05b: события откликов из настоящих откликов — те, что не доставлены, свежие первыми.
 * Анкеты (B703) сюда придут отдельным видом события; пока их нет, строк о них нет.
 */
export function responseEvents(
  applications: readonly ApplicationView[],
  now: Date = new Date(),
): readonly ResponseEvent[] {
  return applications
    .map((application) => ({ application, row: buildResponseRow(application, now) }))
    .filter(({ row }) => row.failure !== null)
    .sort((left, right) => recordedAt(right.application) - recordedAt(left.application))
    .map(({ application, row }) => ({
      id: row.id,
      tag: 'Не доставлен',
      title: 'Отклик не доставлен',
      company: row.company,
      why: `${row.role} · ${capitalize(row.failure ?? '')}`,
      openPath: buildNodePath('o01c', { responseId: row.id }),
      action: eventAction(application, row),
    }));
}
