import { createContext, useContext } from 'react';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { TodayQueueItem } from './todayApi';
import { queueItemTarget } from './todayFormat';

/** Куда ведёт строка очереди: раздел кабинета или «Автоматизация» для постов LinkedIn. */
const OpenAutomationContext = createContext<(() => void) | undefined>(undefined);

export const TodayOpenAutomationProvider = OpenAutomationContext.Provider;

export function useOpenQueueItem(
  onNavigate: ((view: CareerCabinetView) => void) | undefined,
): ((item: TodayQueueItem) => void) | undefined {
  const onOpenAutomation = useContext(OpenAutomationContext);
  return (item) => {
    if (item.kind === 'linkedin_post') onOpenAutomation?.();
    else onNavigate?.(queueItemTarget(item));
  };
}

export function canOpenQueueItem(
  item: TodayQueueItem,
  onNavigate: ((view: CareerCabinetView) => void) | undefined,
  onOpenAutomation: (() => void) | undefined,
): boolean {
  return item.kind === 'linkedin_post' ? Boolean(onOpenAutomation) : Boolean(onNavigate);
}

export function useCanOpenQueueItem(
  item: TodayQueueItem,
  onNavigate: ((view: CareerCabinetView) => void) | undefined,
): boolean {
  return canOpenQueueItem(item, onNavigate, useContext(OpenAutomationContext));
}
