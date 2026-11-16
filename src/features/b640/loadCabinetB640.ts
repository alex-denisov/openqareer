/**
 * B649: загрузчик нового кабинета. Его CSS приходит только вместе с корнем,
 * поэтому аккаунт без флага не получает ни кода, ни стилей B640.
 */
export function loadCabinetB640() {
  const styles = typeof document !== 'undefined' ? import('./cabinet-b640.css') : Promise.resolve();
  return styles.then(() => import('./CabinetB640'));
}
