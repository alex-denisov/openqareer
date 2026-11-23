import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { forgetSharedRead } from '../../resume/sharedRead';
import { PROFILE_CHANGED } from './ExperienceEditScreen';
import {
  photoFileError,
  preparePhoto,
  removePhoto,
  UNREADABLE_PHOTO,
  uploadPhoto,
} from './profileExtrasApi';

/** Что выбрано в окне до «Сохранить»: новое фото или «убрать». */
export type PhotoPending =
  | { readonly kind: 'file'; readonly blob: Blob; readonly preview: string }
  | { readonly kind: 'remove' };

export type PhotoStep =
  | { readonly step: 'idle' }
  | { readonly step: 'reading' | 'saving' }
  | { readonly step: 'error'; readonly message: string };

function messageOf(reason: unknown, fallback: string): string {
  const unreadable = reason instanceof Error && reason.message === UNREADABLE_PHOTO;
  return unreadable ? UNREADABLE_PHOTO : apiErrorMessage(reason, fallback);
}

/**
 * p08 по макету — окно над «Профилем»: файл готовится и показывается сразу, а уходит на сервер
 * только по «Сохранить»; «Отмена» ничего не меняет. После сохранения профиль перечитывается.
 */
export function usePhotoDraft(onSaved: (text: string) => void) {
  const [pending, setPending] = useState<PhotoPending | null>(null);
  const [work, setWork] = useState<PhotoStep>({ step: 'idle' });
  const preview = pending?.kind === 'file' ? pending.preview : null;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function pick(file: File) {
    const refused = photoFileError(file);
    if (refused) {
      setWork({ step: 'error', message: refused });
      return;
    }
    setWork({ step: 'reading' });
    try {
      const blob = await preparePhoto(file);
      setPending({ kind: 'file', blob, preview: URL.createObjectURL(blob) });
      setWork({ step: 'idle' });
    } catch (reason) {
      setWork({ step: 'error', message: messageOf(reason, 'Не удалось открыть фото.') });
    }
  }

  async function save() {
    if (!pending) return;
    const removing = pending.kind === 'remove';
    setWork({ step: 'saving' });
    try {
      await (pending.kind === 'file' ? uploadPhoto(pending.blob) : removePhoto());
      forgetSharedRead('resume');
      window.dispatchEvent(new Event(PROFILE_CHANGED));
      onSaved(removing ? 'Фото убрано' : 'Фото обновлено');
    } catch (reason) {
      const fallback = removing ? 'Не удалось убрать фото.' : 'Не удалось загрузить фото.';
      setWork({ step: 'error', message: messageOf(reason, fallback) });
    }
  }

  return {
    pending,
    work,
    pick: (file: File) => void pick(file),
    remove: () => {
      setPending({ kind: 'remove' });
      setWork({ step: 'idle' });
    },
    save: () => void save(),
  };
}
