import { apiErrorMessage } from '../coach/apiClient';

export async function settle(
  promise: Promise<void>,
  onClose: () => void,
  onError: (message?: string) => void,
): Promise<void> {
  onError(undefined);
  try {
    await promise;
    onClose();
  } catch (reason) {
    onError(apiErrorMessage(reason, 'Не удалось выполнить действие. Попробуйте ещё раз.'));
  }
}
