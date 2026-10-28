let loadedAuthPages: typeof import('./AuthPages') | undefined;

export function getLoadedAuthPages() {
  return loadedAuthPages;
}

export function loadAuthPages() {
  const styles =
    typeof document === 'undefined'
      ? Promise.resolve()
      : Promise.all([import('./landing.css'), import('./auth.css'), import('./authSite.css')]);
  return Promise.all([import('./AuthPages'), styles]).then(([pages]) => {
    if (typeof document !== 'undefined') {
      document.getElementById('root')?.removeAttribute('aria-busy');
    }
    loadedAuthPages = pages;
    return pages;
  });
}

export function preloadAuthPages(): void {
  void loadAuthPages().catch(() => undefined);
}
