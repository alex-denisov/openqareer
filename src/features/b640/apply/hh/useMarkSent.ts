import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../../../coach/apiClient';

/**
 * B716: «Я уже откликнулся» — отклик ушёл вне приложения (руками в окне hh.ru или на сайте).
 * Отметка та же, что после отправки из приложения: отклик уходит из черновиков и «Сегодня».
 */
export type MarkSentState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly text: string };

export function useMarkSent(onSent: () => Promise<void>): { readonly state: MarkSentState; readonly mark: () => void } {
  const [state, setState] = useState<MarkSentState>({ kind: 'idle' });
  const mark = useCallback(() => {
    setState({ kind: 'busy' });
    onSent()
      .then(() => setState({ kind: 'done' }))
      .catch((reason: unknown) =>
        setState({ kind: 'error', text: apiErrorMessage(reason, 'Отметка не сохранилась. Повторите.') }),
      );
  }, [onSent]);
  return { state, mark };
}
