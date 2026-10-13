import type {
  AppUpdateModalType,
  AppUpdateReleaseInfo,
  AppUpdateState,
  AppUpdateStatusData,
  ChangelogItem,
} from './appUpdateTypes';

export const DEFAULT_CHANGELOG: readonly ChangelogItem[] = [
  {
    tag: 'fixed',
    tagLabel: 'Исправлено',
    text: 'Список вакансий больше не пропадает после смены роли.',
  },
  {
    tag: 'fixed',
    tagLabel: 'Исправлено',
    text: 'Мок-интервью сохраняет черновик ответа при потере сети.',
  },
  {
    tag: 'new',
    tagLabel: 'Новое',
    text: 'Раздел «Страны и релокация»: страны, сравнение и расчёт свободного остатка.',
  },
  {
    tag: 'improved',
    tagLabel: 'Улучшено',
    text: 'Профиль открывается быстрее на длинных резюме.',
  },
];

export const DEFAULT_UPDATE_INFO: AppUpdateReleaseInfo = {
  version: '1.0.1',
  currentVersion: '1.0.0',
  releaseDate: '09.10',
  downloadSizeMb: 38,
  downloadedMb: 24,
  progressPercent: 64,
  autoUpdateEnabled: false,
  changelog: DEFAULT_CHANGELOG,
};

export const INITIAL_UPDATE_STATUS: AppUpdateStatusData = {
  state: 'available',
  modal: 'none',
  info: DEFAULT_UPDATE_INFO,
};

export function createUpdateStatus(
  state: AppUpdateState,
  modal: AppUpdateModalType = 'none',
  overrides?: Partial<AppUpdateReleaseInfo>,
): AppUpdateStatusData {
  return {
    state,
    modal,
    info: {
      ...DEFAULT_UPDATE_INFO,
      ...overrides,
    },
  };
}
