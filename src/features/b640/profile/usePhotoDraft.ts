import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { forgetSharedRead } from '../../resume/sharedRead';
import { PROFILE_CHANGED } from './ExperienceEditScreen';
import {
  photoFileError,
  preparePhoto,
  removePhoto,
  saveResumePhoto,
  takeLinkedinPhoto,
  UNREADABLE_PHOTO,
  uploadPhoto,
} from './profileExtrasApi';

/** Что выбрано в окне до «Сохранить»: новое фото, фото из LinkedIn или «убрать». */
export type PhotoPending =
  | { readonly kind: 'file'; readonly blob: Blob; readonly preview: string }
  | { readonly kind: 'linkedin'; readonly mediaId: string }
  | { readonly kind: 'remove' };

export type PhotoStep =
  | { readonly step: 'idle' }
  | { readonly step: 'reading' | 'saving' }
  | { readonly step: 'error'; readonly message: string };

const SAVED_TEXT: Record<PhotoPending['kind'], string> = {
  file: 'Фото обновлено',
  linkedin: 'Фото обновлено',
  remove: 'Фото убрано',
};

const FAILED_TEXT: Record<PhotoPending['kind'], string> = {
  file: 'Не удалось загрузить фото.',
  linkedin: 'Не удалось взять фото из LinkedIn.',
  remove: 'Не удалось убрать фото.',
};

function messageOf(reason: unknown, fallback: string): string {
  const unreadable = reason instanceof Error && reason.message === UNREADABLE_PHOTO;
  return unreadable ? UNREADABLE_PHOTO : apiErrorMessage(reason, fallback);
}

function sendPhoto(pending: PhotoPending): Promise<unknown> {
  if (pending.kind === 'file') return uploadPhoto(pending.blob);
  return pending.kind === 'linkedin' ? takeLinkedinPhoto() : removePhoto();
}

/** Причина неудачи или `null`; после фото профиль перечитывается всеми экранами. */
async function savePhoto(change: PhotoPending): Promise<string | null> {
  try {
    await sendPhoto(change);
    forgetSharedRead('resume');
    window.dispatchEvent(new Event(PROFILE_CHANGED));
    return null;
  } catch (reason) {
    return messageOf(reason, FAILED_TEXT[change.kind]);
  }
}

async function saveSetting(inResume: boolean): Promise<string | null> {
  try {
    await saveResumePhoto(inResume);
    return null;
  } catch (reason) {
    return messageOf(reason, 'Не удалось сохранить «Фото в резюме».');
  }
}

/** Ссылка на выбранный файл живёт, пока он выбран. */
function useRevokedPreview(preview: string | null): void {
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
}

/**
 * p08 по макету — окно над «Профилем»: файл готовится и показывается сразу, а уходит на сервер
 * только по «Сохранить»; «Отмена» ничего не меняет. После сохранения профиль перечитывается.
 * `inResume` — «Фото в резюме» с сервера (`null`, пока читается): уходит тем же «Сохранить».
 */
export function usePhotoDraft(inResume: boolean | null, onSaved: (text: string) => void) {
  const [pending, setPending] = useState<PhotoPending | null>(null);
  const [choice, setInResume] = useState<boolean | null>(null);
  const inResumeChoice = choice ?? inResume ?? true;
  const [work, setWork] = useState<PhotoStep>({ step: 'idle' });
  const settingChanged = choice !== null && choice !== inResume;
  useRevokedPreview(pending?.kind === 'file' ? pending.preview : null);

  function stage(next: PhotoPending) {
    setPending(next);
    setWork({ step: 'idle' });
  }

  async function pick(file: File) {
    const refused = photoFileError(file);
    if (refused) {
      setWork({ step: 'error', message: refused });
      return;
    }
    setWork({ step: 'reading' });
    try {
      const blob = await preparePhoto(file);
      stage({ kind: 'file', blob, preview: URL.createObjectURL(blob) });
    } catch (reason) {
      setWork({ step: 'error', message: messageOf(reason, 'Не удалось открыть фото.') });
    }
  }

  /** Фото уходит первым; при ошибке настройки повтор отправит только её. */
  async function save() {
    if (!pending && !settingChanged) return;
    setWork({ step: 'saving' });
    const photoFailed = pending ? await savePhoto(pending) : null;
    if (!photoFailed && pending) setPending(null);
    const failed = photoFailed ?? (settingChanged ? await saveSetting(inResumeChoice) : null);
    if (failed) {
      setWork({ step: 'error', message: failed });
      return;
    }
    onSaved(pending ? SAVED_TEXT[pending.kind] : 'Сохранено');
  }

  return {
    pending,
    work,
    inResume: inResumeChoice,
    changed: pending !== null || settingChanged,
    setInResume,
    pick: (file: File) => void pick(file),
    takeLinkedin: (mediaId: string) => stage({ kind: 'linkedin', mediaId }),
    remove: () => stage({ kind: 'remove' }),
    save: () => void save(),
  };
}
