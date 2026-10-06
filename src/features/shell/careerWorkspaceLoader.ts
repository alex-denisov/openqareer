export function loadCareerWorkspaceShell() {
  const styles = typeof document !== 'undefined' ? import('./career-shell.css') : Promise.resolve();
  return styles.then(() => import('./CareerWorkspaceShell'));
}

export function preloadCareerWorkspaceShell(): void {
  void loadCareerWorkspaceShell().catch(() => undefined);
}
