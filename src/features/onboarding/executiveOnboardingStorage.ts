import {
  createDefaultExecutiveOnboarding,
  type ExecutiveOnboardingState,
} from './executiveOnboarding';

const STORAGE_KEY = 'openqareer:executive_onboarding';

export function loadExecutiveOnboardingState(): ExecutiveOnboardingState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createDefaultExecutiveOnboarding('Новая компания', 'Руководитель');
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultExecutiveOnboarding('Новая компания', 'Руководитель');
    }
    const parsed = JSON.parse(raw) as ExecutiveOnboardingState;
    if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      return parsed;
    }
  } catch {
    // Игнорируем ошибку чтения локального хранилища и возвращаем дефолт
  }

  return createDefaultExecutiveOnboarding('Новая компания', 'Руководитель');
}

export function saveExecutiveOnboardingState(state: ExecutiveOnboardingState): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Игнорируем ошибку записи локального хранилища
  }
}
