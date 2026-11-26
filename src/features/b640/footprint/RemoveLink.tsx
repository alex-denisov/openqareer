import { useState } from 'react';
import { useToast } from '../kit/Toast';
import { removeLink, saveLink } from './profileLinks';
import { reportFailure } from './reportFailure';

/** «Убрать» у ссылки в «Данных для поиска»; тост даёт вернуть её (B668). */
export function RemoveLink({ link }: { readonly link: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function restore() {
    try {
      if ((await saveLink(link)) === 'full') toast.show({ text: 'В профиле уже 20 ссылок' });
    } catch (reason) {
      reportFailure('ссылка для поиска не вернулась', reason);
      toast.show({ text: 'Ссылка не вернулась' });
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await removeLink(link);
      toast.show({
        text: 'Ссылка убрана',
        undo: { label: 'Отменить', onUndo: () => void restore() },
      });
    } catch (reason) {
      reportFailure('ссылка для поиска не убрана', reason);
      toast.show({ text: 'Ссылка не убрана' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className="row-act"
      type="button"
      disabled={busy}
      aria-label={`Убрать ${link}`}
      onClick={() => void remove()}
    >
      Убрать
    </button>
  );
}
