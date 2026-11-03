import { createContext, useContext } from 'react';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { TodayQueueItem } from './todayApi';
import { queueItemTarget } from './todayFormat';

/** Куда ведёт строка очереди: раздел кабинета или «Автоматизация» для постов LinkedIn. */
const OpenAutomationContext = createContext<(() => void) | undefined>(undefined);

export const TodayOpenAutomationProvider = OpenAutomationContext.Provider;

export function useOpenQueueItem(
  onNavigate: ((view: CareerCabinetView, options?: NavigationOptions) => void) | undefined,
): ((item: TodayQueueItem) => void) | undefined {
  const onOpenAutomation = useContext(OpenAutomationContext);
  return (item) => {
    if (item.kind === 'linkedin_post') {
      onOpenAutomation?.();
      return;
    }
    const target = queueItemTarget(item);
    // A response row lands on that response: its panel at 1440, its «Процесс» push at 390.
    const options =
      target === 'responses' && item.applicationId
        ? { applicationId: item.applicationId }
        : undefined;
    onNavigate?.(target, options);
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
