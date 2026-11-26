import { useId, useState } from 'react';
import { Button, ResultLine, RowAction, StatusLine } from '../kit';
import { addOwnRole } from './careerApi';

const MIN_LENGTH = 2;
const MAX_LENGTH = 200;

type State = 'closed' | 'open' | 'busy' | 'error' | 'done';

function TitleField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Своя роль</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder="Например, руководитель проектного офиса"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** «Назвать свою роль»: роль кандидата становится ролью поиска. */
export function OwnRole({ onAdded }: { readonly onAdded: () => void }) {
  const [state, setState] = useState<State>('closed');
  const [title, setTitle] = useState('');
  const trimmed = title.trim();
  const valid = trimmed.length >= MIN_LENGTH && trimmed.length <= MAX_LENGTH;

  const add = async () => {
    setState('busy');
    try {
      await addOwnRole(trimmed);
      setState('done');
      setTitle('');
      onAdded();
    } catch {
      setState('error');
    }
  };

  if (state === 'closed' || state === 'done') {
    return (
      <>
        {state === 'done' ? <ResultLine text="Роль добавлена в поиск" /> : null}
        <RowAction small icon="edit" onClick={() => setState('open')}>
          Назвать свою роль
        </RowAction>
      </>
    );
  }
  return (
    <div className="cc-edit" role="group" aria-label="Добавление роли">
      <TitleField value={title} onChange={setTitle} />
      {state === 'error' ? (
        <StatusLine state="err" text="Роль не добавилась. Название осталось в поле." />
      ) : null}
      <div className="cc-acts">
        <Button icon="plus" busy={state === 'busy'} disabled={!valid} onClick={() => void add()}>
          Добавить роль
        </Button>
        <RowAction neutral onClick={() => setState('closed')}>
          Отменить
        </RowAction>
      </div>
    </div>
  );
}
