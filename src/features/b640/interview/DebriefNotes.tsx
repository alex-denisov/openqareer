import { useState } from 'react';
import { Button, Icon, Link, StatusLine } from '../kit';
import { buildNodePath } from '../routes';
import { saveDebriefNotes } from './data/debriefApi';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** «Ваши заметки» и «Сохранить разбор»: есть и без записи, и когда модель не ответила. */
export function DebriefNotes(props: { readonly responseId: string; readonly initial: string }) {
  const [notes, setNotes] = useState(props.initial);
  const [state, setState] = useState<SaveState>('idle');
  async function save() {
    setState('saving');
    try {
      await saveDebriefNotes(props.responseId, notes);
      setState('saved');
    } catch {
      setState('failed');
    }
  }
  return (
    <>
      <div className="field" id="own">
        <label htmlFor="db-note">Ваши заметки</label>
        <textarea
          id="db-note"
          value={notes}
          onChange={(event) => {
            setNotes(event.currentTarget.value);
            setState('idle');
          }}
        />
      </div>
      {state === 'saved' ? <StatusLine state="ok" text="Разбор сохранён" /> : null}
      {state === 'failed' ? (
        <StatusLine state="err" text="Разбор не сохранился. Попробуйте ещё раз." />
      ) : null}
      <div className="actions m-commit">
        <Button variant="primary" disabled={state === 'saving'} onClick={() => void save()}>
          <Icon name="check" />
          Сохранить разбор
        </Button>
        <Link className="btn" to={buildNodePath('o06')}>
          Внести оффер
        </Link>
      </div>
    </>
  );
}
