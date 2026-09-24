export type ShellSection =
  | 'today'
  | 'profile'
  | 'resume'
  | 'career'
  | 'opportunities'
  | 'responses'
  | 'tariffs';

export interface ShellNavigationState {
  /** The diagnostic has produced a career picture, so the wizard is finished. */
  readonly careerPictureReady: boolean;
  /** Resume Studio reads a candidate-scoped API and needs a signed-in account. */
  readonly resumeAvailable: boolean;
  /** A workspace or a cabinet session exists to render the section from. */
  readonly canUseWorkspaceViews: boolean;
}

/**
 * Which sections a candidate may open.
 *
 * «Сегодня» is always reachable because the wizard itself lives there. Every
 * other section — «Тарифы» included since B169 §5 — waits for the diagnostic
 * to produce a career picture. Pricing shown mid-wizard asks the candidate to
 * buy a result the product has not shown them yet, and it is a door out of an
 * unfinished diagnostic that leads nowhere useful.
 */
export function isSectionNavigable(
  section: ShellSection,
  state: ShellNavigationState,
): boolean {
  if (section === 'today') return true;
  if (!state.careerPictureReady) return false;
  if (section === 'resume') return state.resumeAvailable;
  if (section === 'tariffs') return true;
  return state.canUseWorkspaceViews;
}

/** Why a closed section is closed, in the candidate's language. */
export function sectionLockReason(
  section: ShellSection,
  state: ShellNavigationState,
): string {
  if (!state.careerPictureReady) {
    return 'Завершите карьерную диагностику, чтобы открыть раздел';
  }
  return section === 'resume'
    ? 'Резюме доступно после входа в аккаунт'
    : 'Сначала соберите карьерную картину';
}
