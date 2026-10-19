import { useEffect, useState } from 'react';
import { getCareerDiaryOverview, listCareerDiaryReviews } from '../diary/careerDiaryApi';
import type { TodayDiaryDecisionProp } from './todayDecisionOverride';
import { todayDiaryDecision } from './todayDiaryDecision';

const POSTPONE_KEY = 'openqareer.today-diary-postponed';

function postponedToday(asOf: string): boolean {
  try {
    return localStorage.getItem(POSTPONE_KEY) === asOf;
  } catch {
    return false;
  }
}

function rememberPostpone(asOf: string): void {
  try {
    localStorage.setItem(POSTPONE_KEY, asOf);
  } catch {
    // Без хранилища «Отложить» действует до перезагрузки — решение не пропадает молча.
  }
}

/**
 * Читает дневник для «Сегодня» (макет 1 «Вы работаете»). Дневник не заведён,
 * недоступен по тарифу или не ответил — решения из дневника нет, экран тот же.
 */
export function useTodayDiaryDecision(enabled: boolean): TodayDiaryDecisionProp | undefined {
  const [decision, setDecision] = useState<TodayDiaryDecisionProp>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([
      getCareerDiaryOverview(controller.signal),
      listCareerDiaryReviews({ limit: 1, signal: controller.signal }),
    ])
      .then(([overview, reviews]) => {
        const action = todayDiaryDecision(overview, reviews.items[0] ?? null);
        if (!action || postponedToday(overview.asOf)) return;
        setDecision({
          action,
          onPostpone: () => {
            rememberPostpone(overview.asOf);
            setDecision(undefined);
          },
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);
  return decision;
}
