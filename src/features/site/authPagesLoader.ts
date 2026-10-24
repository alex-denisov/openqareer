export function loadAuthPages() {
  const styles = typeof document === 'undefined'
    ? Promise.resolve()
    : Promise.all([import('./landing.css'), import('./auth.css')]);
  return Promise.all([import('./AuthPages'), styles]).then(([pages]) => {
    if (typeof document !== 'undefined') {
      document.getElementById('root')?.removeAttribute('aria-busy');
    }
    return pages;
  });
}

export function preloadAuthPages(): void {
  void loadAuthPages().catch(() => undefined);
}
