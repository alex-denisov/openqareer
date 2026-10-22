/** Одновременные вызовы делят один запрос; после ответа или ошибки следующий вызов спрашивает заново. */
export function shareInFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () =>
    (inFlight ??= load().finally(() => {
      inFlight = null;
    }));
}
