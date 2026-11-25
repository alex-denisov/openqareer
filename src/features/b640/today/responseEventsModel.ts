import type { ApplicationView } from '../../applications/applicationsApi';
import type { IconName } from '../kit/Icon';
import { actionPath } from '../responses/ResponsesTable';
import { platformOf } from '../responses/model/platform';
import { buildResponseRow, type ResponseRow } from '../responses/model/responseRow';
import type { ManualApplyItem } from '../../../../shared/manualApply';
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
  /** Отклик не дошёл (красная метка) или ждёт кандидата. */
  readonly failed: boolean;
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

/** «Сегодня» называет первые отклики очереди, весь список — в «Откликах». */
const MANUAL_SHOWN = 3;

/** Отклики, которые кандидат отправляет сам: готовые и те, где нужен его ответ. */
function manualEvents(
  applications: readonly ApplicationView[],
  now: Date,
  manual: ReadonlyMap<string, ManualApplyItem>,
): readonly ResponseEvent[] {
  return applications
    .flatMap((application) => {
      const item = manual.get(application.id);
      const waiting = item && application.stage === 'saved' && item.state !== 'preparing';
      return waiting ? [buildResponseRow(application, now, { manual: item })] : [];
    })
    .slice(0, MANUAL_SHOWN)
    .map((row) => ({
      id: row.id,
      tag: capitalize(row.tag.label),
      failed: false,
      title: row.action?.step === 'form' ? 'Ответьте на вопросы' : 'Отправьте отклик',
      company: row.company,
      why: `${row.role} · ${row.next}`,
      openPath: actionPath(row),
      action: {
        label: row.action?.label ?? 'Открыть отклик',
        icon: row.action?.icon ?? 'right',
        path: actionPath(row),
      },
    }));
}

/**
 * B650 s05b: события откликов из настоящих откликов — те, что не доставлены, свежие первыми.
 * Ниже — отклики, готовые к отправке самим кандидатом (B787).
 * Анкеты (B703) сюда придут отдельным видом события; пока их нет, строк о них нет.
 */
export function responseEvents(
  applications: readonly ApplicationView[],
  now: Date = new Date(),
  manual: ReadonlyMap<string, ManualApplyItem> = new Map(),
): readonly ResponseEvent[] {
  return [...failedEvents(applications, now), ...manualEvents(applications, now, manual)];
}

function failedEvents(
  applications: readonly ApplicationView[],
  now: Date,
): readonly ResponseEvent[] {
  return applications
    .map((application) => ({ application, row: buildResponseRow(application, now) }))
    .filter(({ row }) => row.failure !== null)
    .sort((left, right) => recordedAt(right.application) - recordedAt(left.application))
    .map(({ application, row }) => ({
      id: row.id,
      tag: 'Не доставлен',
      failed: true,
      title: 'Отклик не доставлен',
      company: row.company,
      why: `${row.role} · ${capitalize(row.failure ?? '')}`,
      openPath: buildNodePath('o01c', { responseId: row.id }),
      action: eventAction(application, row),
    }));
}
