export function loadAuthPages() {
  return import('./AuthPages').then((pages) => {
    if (typeof document !== 'undefined') {
      document.getElementById('root')?.removeAttribute('aria-busy');
    }
    return pages;
  });
}

export function preloadAuthPages(): void {
  void loadAuthPages().catch(() => undefined);
}
