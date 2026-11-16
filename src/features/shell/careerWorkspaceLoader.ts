import { readRememberedCabinetB640 } from '../site/signedInFlag';

export function loadCareerWorkspaceShell() {
  const styles = typeof document !== 'undefined' ? import('./career-shell.css') : Promise.resolve();
  return styles.then(() => import('./CareerWorkspaceShell'));
}

export function preloadCareerWorkspaceShell(): void {
  // B649: аккаунту с новым кабинетом прежняя оболочка не нужна заранее.
  if (readRememberedCabinetB640()) return;
  void loadCareerWorkspaceShell().catch(() => undefined);
}
