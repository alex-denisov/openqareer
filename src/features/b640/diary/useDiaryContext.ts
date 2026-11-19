import { useEffect, useState } from 'react';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { getOverview, listGoalCards } from './diaryApi';

export interface DiaryContext {
  /** Активные цели верхнего уровня. */
  readonly goals: readonly CareerDiaryGoalCard[];
  /** День начала дневника: от него считаются номера недель; `null` — не известен. */
  readonly origin: string | null;
}

const EMPTY: DiaryContext = { goals: [], origin: null };

/**
 * Цели и начало дневника для подписей ленты. Сбой чтения не мешает записям:
 * лента показывается без названий целей и без номеров недель.
 */
export function useDiaryContext(): DiaryContext {
  const [context, setContext] = useState<DiaryContext>(EMPTY);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listGoalCards(), getOverview()]).then(([cards, overview]) => {
      if (!active) return;
      setContext({
        goals: cards.status === 'fulfilled' ? cards.value.items : [],
        origin:
          overview.status === 'fulfilled'
            ? (overview.value.platformStartedAt?.slice(0, 10) ?? null)
            : null,
      });
    });
    return () => {
      active = false;
    };
  }, []);
  return context;
}
