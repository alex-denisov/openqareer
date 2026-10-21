import { useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';

export type ProfileEntrySaveResult = boolean | void | Promise<boolean | void>;

export function useProfileEntrySave<Patch>(
  onSave: (patch: Patch) => ProfileEntrySaveResult,
  validationMessage: (patch: Patch) => string | undefined,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (patch: Patch): Promise<boolean> => {
    if (busy) return false;
    const invalid = validationMessage(patch);
    if (invalid) {
      setError(invalid);
      return false;
    }
    setBusy(true);
    setError('');
    try {
      if ((await onSave(patch)) === false) {
        setError('Не сохранилось: нет связи с сервером. Текст остался в поле.');
        return false;
      }
      return true;
    } catch (reason) {
      setError(
        apiErrorMessage(reason, 'Не сохранилось: нет связи с сервером. Текст остался в поле.'),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}
