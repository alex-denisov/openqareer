import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManualApplyItem, ManualApplyReason } from '../../../../shared/manualApply';
import { platformOf } from '../responses/model/platform';
import { getManualApply, queueManualApply } from './data/manualApplyApi';
import { applyPressed, forgetApply } from './applyIntent';
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

/** В очередь отклик ставит только нажатие «Откликнуться» или «Отправить», а не открытый адрес. */
function usePressed({ vacancyId, application }: ApplyTarget) {
  const applicationId = application?.id;
  const [pressed, setPressed] = useState(
    () => applyPressed(vacancyId) || Boolean(applicationId && applyPressed(applicationId)),
  );
  useEffect(() => {
    forgetApply(vacancyId);
    if (applicationId) forgetApply(applicationId);
  }, [vacancyId, applicationId]);
  // Отправка, начатая нажатием, узнаёт о нём до следующей отрисовки.
  const now = useRef(pressed);
  const press = useCallback(() => {
    now.current = true;
    setPressed(true);
  }, []);
  return { pressed, press, now };
}

function useRefreshWhilePreparing(known: Known, refresh: () => void): void {
  const preparing = known !== null && known !== 'loading' && known.preparing;
  useEffect(() => {
    if (!preparing) return undefined;
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preparing, refresh]);
}

/**
 * Отклик, который кандидат отправляет сам (B787). LinkedIn встаёт в очередь нажатием
 * «Откликнуться»; остальные попадают в неё по причине площадки. Не в очереди — обычный отклик.
 */
export function useManualApply(
  target: ApplyTarget,
  source: string | undefined,
): {
  readonly manual: ManualApplyFlow | 'loading' | null;
  readonly queue: QueueManual;
  /** Открыто без нажатия: сам экран ничего не ставит. */
  readonly declined: boolean;
  /** После «Не откликаюсь» без нажатия форма сайта сама не читается. */
  readonly held: boolean;
  readonly press: () => void;
} {
  const { vacancyId } = target;
  const { pressed, press, now } = usePressed(target);
  const unsent = isUnsent(target);
  const declined = unsent && !pressed;
  const held = declined && target.application?.stage === 'archived';
  const linkedin = Boolean(source) && platformOf(source).label === 'LinkedIn';
  const [known, setKnown] = useState<Known>(unsent ? 'loading' : null);

  useEffect(() => {
    if (!unsent) return undefined;
    let active = true;
    const read =
      linkedin && !declined
        ? queueManualApply({ vacancyId, reason: 'linkedin' })
        : getManualApply(vacancyId);
    read.then((item) => active && setKnown(item)).catch(() => active && setKnown(null));
    return () => {
      active = false;
    };
  }, [vacancyId, unsent, linkedin, declined]);

  const refresh = useCallback(() => {
    getManualApply(vacancyId)
      .then(setKnown)
      .catch(() => undefined);
  }, [vacancyId]);

  useRefreshWhilePreparing(known, refresh);

  const queue = useCallback(
    async (reason: ManualApplyReason, host?: string): Promise<boolean> => {
      if (!now.current) return false;
      try {
        setKnown(await queueManualApply({ vacancyId, reason, ...(host ? { host } : {}) }));
        return true;
      } catch {
        return false;
      }
    },
    [vacancyId, now],
  );
  const manual = known === null || known === 'loading' ? known : { item: known, refresh };
  return { manual, queue, declined, held, press };
}
