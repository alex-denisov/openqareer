import { useEffect, useState } from 'react';
import type { CareerDiaryWorkplace } from '../../../../shared/careerDiary';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { getOverview, listGoalCards } from './diaryApi';

export interface DiaryContext {
  /** Активные цели верхнего уровня. */
  readonly goals: readonly CareerDiaryGoalCard[];
  /** День начала дневника: от него считаются номера недель; `null` — не известен. */
  readonly origin: string | null;
  /** Основное место работы; `null` — его нет или обзор не прочитался. */
  readonly workplace: CareerDiaryWorkplace | null;
  /** Обзор прочитан: место работы известно (или его точно нет). */
  readonly workplaceKnown: boolean;
  /** Цели прочитаны. */
  readonly goalsKnown: boolean;
}

const EMPTY: DiaryContext = {
  goals: [],
  origin: null,
  workplace: null,
  workplaceKnown: false,
  goalsKnown: false,
};

/**
 * Цели и начало дневника для подписей ленты. Сбой чтения не мешает записям:
 * лента показывается без названий целей и без номеров недель. Новое значение `attempt`
 * перечитывает непрочитанное вместе с лентой.
 */
export function useDiaryContext(attempt = 0): DiaryContext {
  const [context, setContext] = useState<DiaryContext>(EMPTY);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([listGoalCards(), getOverview()]).then(([cards, overview]) => {
      if (!active) return;
      setContext((current) => ({
        ...current,
        ...(cards.status === 'fulfilled' ? { goals: cards.value.items, goalsKnown: true } : {}),
        ...(overview.status === 'fulfilled'
          ? {
              origin: overview.value.platformStartedAt?.slice(0, 10) ?? null,
              workplace: overview.value.primaryWorkplace ?? null,
              workplaceKnown: true,
            }
          : {}),
      }));
    });
    return () => {
      active = false;
    };
  }, [attempt]);
  return context;
}
