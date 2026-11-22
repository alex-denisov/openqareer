import type { FootprintRemoval } from '../../../../shared/footprintRemoval';
import type { FootprintRiskItem } from '../../../../shared/footprintRisk';
import { shortDate } from './footprintModel';

/**
 * B382: что стоит в нижней панели f03b. `request` — «Письмо отправлено»;
 * `check` — проверка адреса этой находки; `rerun` — новая проверка всего следа,
 * когда находку нечем проверить по отдельности.
 */
export type RemovalDock = 'request' | 'check' | 'rerun';

export function removalDock(item: FootprintRiskItem): RemovalDock {
  if (!item.findingId) return 'rerun';
  if (!item.removal?.requestedAt) return 'request';
  return item.url ? 'check' : 'rerun';
}

const RESULT_TEXT = { still_there: 'Ещё на месте', unclear: 'Сайт не ответил' } as const;

/** Строка у кнопки: дата письма, после проверки — её итог. Удалено — строка над находкой. */
export function removalNote(removal: FootprintRemoval | undefined): string | null {
  if (!removal) return null;
  const checked = shortDate(removal.checkedAt ?? null);
  if (removal.result && removal.result !== 'removed' && checked) {
    return `${RESULT_TEXT[removal.result]} · проверено ${checked}`;
  }
  if (removal.result === 'removed') return null;
  const requested = shortDate(removal.requestedAt ?? null);
  return requested ? `Письмо отправлено ${requested}` : null;
}

/** Дата проверки, подтвердившей удаление; `null` — удаление не подтверждено. */
export function removalDone(removal: FootprintRemoval | undefined): string | null {
  return removal?.result === 'removed' ? shortDate(removal.checkedAt ?? null) : null;
}

const CHECK_TEXT = {
  removed: 'Удалено',
  still_there: 'Ещё на месте',
  unclear: 'Сайт не ответил',
} as const;

export interface RemovalRequestLine {
  readonly id: string;
  readonly title: string;
  readonly date: string;
}

export interface ChecksStatus {
  /** «Удалено: телефон из объявления» — итог последней проверки находки; `null` — проверок не было. */
  readonly lastCheck: string | null;
  /** Запросы сайтам, ещё не закрытые подтверждённым удалением. */
  readonly requests: readonly RemovalRequestLine[];
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase('ru-RU') + text.slice(1);
}

/** B645 p02 «Проверки и запросы»: итог последней проверки и отправленные запросы. */
export function checksStatus(items: readonly FootprintRiskItem[]): ChecksStatus {
  const checked = items
    .filter((item) => item.removal?.checkedAt && item.removal.result)
    .sort((a, b) => (b.removal?.checkedAt ?? '').localeCompare(a.removal?.checkedAt ?? ''))[0];
  const result = checked?.removal?.result;
  const requests = items.flatMap((item) => {
    const date = shortDate(item.removal?.requestedAt ?? null);
    return date && item.removal?.result !== 'removed'
      ? [{ id: item.id, title: item.title, date }]
      : [];
  });
  return {
    lastCheck: checked && result ? `${CHECK_TEXT[result]}: ${lowerFirst(checked.title)}` : null,
    requests,
  };
}
