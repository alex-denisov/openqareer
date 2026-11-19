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
