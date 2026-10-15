import type { CoachTurnStage } from '../coach/coachApi';
import type { ShellSection } from './shellNavigation';

export type ShellView = ShellSection;

export const SESSION_GATE_DELAY_MS = 4_000;
export const DESKTOP_EXPERT_PREFERENCE_KEY = 'openqareer.desktop-expert-panel';

export const pageNames: Record<ShellView, string> = {
  today: 'Сегодня',
  profile: 'Профиль',
  resume: 'Резюме',
  career: 'Карьера',
  opportunities: 'Вакансии',
  responses: 'Отклики',
  notifications: 'Уведомления',
  automation: 'Автоматизация',
  diary: 'Карьерный дневник',
  tariffs: 'Тарифы',
};

export function stageForView(view: ShellView): CoachTurnStage {
  if (view === 'profile') return 'profile';
  if (view === 'career') return 'career';
  if (view === 'opportunities') return 'vacancies';
  if (view === 'responses' || view === 'automation') return 'responses';
  return 'today';
}

export function readDesktopExpertPreference(): 'open' | 'closed' | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(DESKTOP_EXPERT_PREFERENCE_KEY);
    return value === 'open' || value === 'closed' ? value : null;
  } catch {
    return null;
  }
}

export function matchesMedia(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  );
}

export function hasClosedDesktopExpertPreference(): boolean {
  return matchesMedia('(min-width: 1280px)') && readDesktopExpertPreference() === 'closed';
}

export function initialExpertPanelOpen(sessionPending: boolean, initialView: ShellView): boolean {
  if (typeof window === 'undefined') return false;
  const desktop = matchesMedia('(min-width: 1280px)');
  if (desktop && readDesktopExpertPreference() === 'closed') return false;
  // While the session is checked the panel stays on the phone sheet and a wide desktop; a
  // narrowed desktop window keeps its columns until the candidate opens the consultant.
  if (sessionPending) return desktop || !matchesMedia('(min-width: 761px)');
  return desktop || (initialView === 'opportunities' && matchesMedia('(min-width: 761px)'));
}

// The window can be resized while the cabinet is open: below the desktop width the
// consultant folds away so the screen keeps its columns, above it the panel returns
// unless the candidate closed it on purpose.
export function expertPanelOpenOnWidthChange(wide: boolean): boolean {
  return wide && readDesktopExpertPreference() !== 'closed';
}
