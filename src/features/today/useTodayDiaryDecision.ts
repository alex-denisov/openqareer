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

/** Разборы читаются, только когда есть активное место: остальным лишний запрос не нужен. */
async function readDiary(signal: AbortSignal) {
  const overview = await getCareerDiaryOverview(signal);
  if (overview.primaryWorkplace?.status !== 'active') return { overview, latest: null };
  const reviews = await listCareerDiaryReviews({ limit: 1, signal });
  return { overview, latest: reviews.items[0] ?? null };
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
    void readDiary(controller.signal)
      .then(({ overview, latest }) => {
        const action = todayDiaryDecision(overview, latest);
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
