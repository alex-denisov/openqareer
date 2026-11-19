import { useCallback, useState } from 'react';
import {
  DIARY_ENTRY_TEXT_MAX,
  type CareerDiaryEntry,
  type CareerDiaryEntryKind,
} from '../../../../shared/careerDiaryEntries';
import { useDictation } from '../consultant/useDictation';
import { Icon } from '../kit/Icon';
import type { ComposerDictation } from '../kit/Composer';
import { StatusLine } from '../kit/ResultLine';
import { createEntry } from './diaryApi';
import { today } from './model';
import { RetryButton } from './parts';

export interface QuickEntryProps {
  /** Вид новой записи: выбранный фильтр, при «Все» — заметка. */
  readonly kind: CareerDiaryEntryKind;
  readonly onCreated: (entry: CareerDiaryEntry) => void;
}

function useQuickSubmit({ kind, onCreated }: QuickEntryProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const blank = text.trim() === '';

  async function submit() {
    if (busy) return;
    if (blank) {
      document.getElementById('dn-new')?.focus();
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const entry = await createEntry({ date: today(), kind, text: text.trim() });
      setText('');
      onCreated(entry);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { text, setText, busy, failed, submit };
}

function MicButton({
  dictation,
  text,
}: {
  readonly dictation: ComposerDictation;
  readonly text: string;
}) {
  if (!dictation.supported) return null;
  return (
    <button
      className="icon-btn mic-btn"
      type="button"
      aria-label={dictation.recording ? 'Остановить диктовку' : 'Надиктовать'}
      aria-pressed={dictation.recording}
      onClick={() => (dictation.recording ? dictation.stop() : dictation.start(text))}
    >
      <Icon name={dictation.recording ? 'micoff' : 'mic'} />
    </button>
  );
}

/** Быстрая запись над лентой (`form.dn-quick`): текст или диктовка и «Записать». */
export function QuickEntry(props: QuickEntryProps) {
  const { text, setText, busy, failed, submit } = useQuickSubmit(props);
  const onDictated = useCallback((value: string) => setText(value), [setText]);
  const dictation = useDictation(onDictated);
  return (
    <>
      <form
        className="dn-quick"
        aria-label="Быстрая запись"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dn-q-row dn-q-grid">
          <div className="fld-mic">
            <label className="vh" htmlFor="dn-new">
              Новая запись
            </label>
            <input
              id="dn-new"
              type="text"
              placeholder="Что произошло?"
              value={text}
              maxLength={DIARY_ENTRY_TEXT_MAX}
              onChange={(event) => setText(event.target.value)}
            />
            <MicButton dictation={dictation} text={text} />
          </div>
          <button className="btn is-primary" type="submit" disabled={busy}>
            <Icon name="plus" />
            Записать
          </button>
        </div>
      </form>
      {failed ? (
        <StatusLine
          state="err"
          text="Запись не сохранилась"
          action={<RetryButton onClick={() => void submit()} />}
        />
      ) : null}
      {dictation.denied ? <StatusLine state="err" text="Нет доступа к микрофону" /> : null}
    </>
  );
}
