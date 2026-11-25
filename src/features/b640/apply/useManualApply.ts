import { useCallback, useEffect, useState } from 'react';
import type { ManualApplyItem, ManualApplyReason } from '../../../../shared/manualApply';
import { platformOf } from '../responses/model/platform';
import { getManualApply, queueManualApply } from './data/manualApplyApi';
import type { ApplyTarget } from './model/applyModel';

const REFRESH_MS = 3000;

export interface ManualApplyFlow {
  readonly item: ManualApplyItem;
  /** Перечитать состояние: после ответов на вопросы. */
  readonly refresh: () => void;
}

/** Поставить этот отклик в очередь: отправить его может только кандидат. `false` — не вышло. */
export type QueueManual = (reason: ManualApplyReason, host?: string) => Promise<boolean>;

type Known = ManualApplyItem | 'loading' | null;

/** Отклик ещё не отправлен: черновик, архив после «Не откликаюсь» или отклика пока нет. */
export function isUnsent({ application }: ApplyTarget): boolean {
  return !application || application.stage === 'saved' || application.stage === 'archived';
}

/**
 * Отклик, который кандидат отправляет сам (B787). LinkedIn встаёт в очередь нажатием
 * «Откликнуться»; остальные попадают в неё по причине площадки. Не в очереди — обычный отклик.
 */
export function useManualApply(
  target: ApplyTarget,
  source: string | undefined,
): { readonly manual: ManualApplyFlow | 'loading' | null; readonly queue: QueueManual } {
  const { vacancyId } = target;
  const unsent = isUnsent(target);
  const linkedin = Boolean(source) && platformOf(source).label === 'LinkedIn';
  const [known, setKnown] = useState<Known>(unsent ? 'loading' : null);

  useEffect(() => {
    if (!unsent) return undefined;
    let active = true;
    const read = linkedin
      ? queueManualApply({ vacancyId, reason: 'linkedin' })
      : getManualApply(vacancyId);
    read.then((item) => active && setKnown(item)).catch(() => active && setKnown(null));
    return () => {
      active = false;
    };
  }, [vacancyId, unsent, linkedin]);

  const refresh = useCallback(() => {
    getManualApply(vacancyId)
      .then(setKnown)
      .catch(() => undefined);
  }, [vacancyId]);

  const preparing = known !== null && known !== 'loading' && known.preparing;
  useEffect(() => {
    if (!preparing) return undefined;
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preparing, refresh]);

  const queue = useCallback(
    async (reason: ManualApplyReason, host?: string): Promise<boolean> => {
      try {
        setKnown(await queueManualApply({ vacancyId, reason, ...(host ? { host } : {}) }));
        return true;
      } catch {
        return false;
      }
    },
    [vacancyId],
  );
  const manual = known === null || known === 'loading' ? known : { item: known, refresh };
  return { manual, queue };
}
