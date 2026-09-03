import { useEffect, useState } from 'react';
import { getRoleHypotheses } from '../coach/coachApi';
import type { ProposedRole } from '../../../shared/roleProposals';

export interface RoleHypothesesRead {
  readonly roles: readonly ProposedRole[];
  readonly loading: boolean;
  readonly failed: boolean;
}

/**
 * Гипотезы роли приходят готовыми с сервера (B180, срез 1б).
 *
 * Раньше их считал браузер по прочитанному пулу, но страница подбора вырезает
 * требования ради байтового бюджета маршрута (INC-029): из 320 прочитанных на
 * проде записей требования были у нуля, и панель честно отказывала всегда.
 * Расчёт переехал туда, где пул полный; сюда приезжают три роли.
 */
export function useRoleHypotheses(provided?: RoleHypothesesRead): RoleHypothesesRead {
  const [roles, setRoles] = useState<readonly ProposedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (provided) return;
    const controller = new AbortController();
    let active = true;
    getRoleHypotheses(controller.signal)
      .then((read) => {
        if (active) setRoles(read);
      })
      .catch(() => {
        // Не прочитали — это не «рынок ничего не назвал»: молчание сделало бы
        // недоступный маршрут неотличимым от честно пустого рынка.
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [provided]);

  return provided ?? { roles, loading, failed };
}
