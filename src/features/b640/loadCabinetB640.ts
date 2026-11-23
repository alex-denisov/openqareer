/**
 * B649: загрузчик нового кабинета. Его CSS приходит только вместе с корнем,
 * поэтому аккаунт без флага не получает ни кода, ни стилей B640.
 */
export function loadCabinetB640() {
  const browser = typeof document !== 'undefined';
  const styles = browser ? import('./styles/index') : Promise.resolve();
  // B773: раздел адреса и его данные грузятся рядом с корнем, а не после его отрисовки.
  if (browser)
    void import('./sections')
      .then((module) => module.preloadSection(window.location.pathname))
      .catch(() => undefined);
  return styles.then(() => import('./CabinetB640'));
}
