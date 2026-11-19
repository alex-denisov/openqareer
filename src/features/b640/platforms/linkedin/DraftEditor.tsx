import { useRef, useState, type ChangeEvent } from 'react';
import { ResultLine, RowAction, StatusLine } from '../../kit';
import { updateDraft, type LinkedinDraft } from '../../../today/linkedinDraftApi';
import { CopyButton } from './CopyButton';
import { LiError } from './LiError';

type Save = 'idle' | 'busy' | 'done' | 'error';

function Actions({
  text,
  dirty,
  onSave,
  onReject,
}: {
  readonly text: string;
  readonly dirty: boolean;
  readonly onSave: () => void;
  readonly onReject: () => void;
}) {
  return (
    <div className="actions">
      <CopyButton text={text} label="пост" caption="Скопировать" />
      {dirty ? (
        <RowAction type="button" icon="check" onClick={onSave}>
          Сохранить
        </RowAction>
      ) : null}
      <RowAction type="button" onClick={onReject}>
        Не публиковать
      </RowAction>
    </div>
  );
}

function SaveStatus({
  save,
  dirty,
  onRetry,
}: {
  readonly save: Save;
  readonly dirty: boolean;
  readonly onRetry: () => void;
}) {
  if (save === 'busy') return <StatusLine state="wait" text="Сохраняем…" />;
  if (save === 'done' && !dirty) return <ResultLine text="Сохранено" />;
  if (save === 'error') return <LiError text="Не удалось сохранить" onRetry={onRetry} />;
  return null;
}

/** Текущий черновик: правка текста, «Скопировать», «Не публиковать». Публикации на площадке нет. */
export function DraftEditor({
  draft,
  onChanged,
}: {
  readonly draft: LinkedinDraft;
  readonly onChanged: () => void;
}) {
  const [text, setText] = useState(draft.text);
  const [save, setSave] = useState<Save>('idle');
  const last = useRef<() => void>(() => undefined);
  const dirty = text !== draft.text;

  async function run(update: Parameters<typeof updateDraft>[1], after: () => void) {
    last.current = () => void run(update, after);
    setSave('busy');
    try {
      await updateDraft(draft.id, update);
      after();
    } catch {
      setSave('error');
    }
  }

  const edit = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    setSave('idle');
  };
  const saveText = () =>
    void run({ text }, () => {
      setSave('done');
      onChanged();
    });

  return (
    <section className="lead" aria-labelledby="po-title">
      <h2 className="po-name" id="po-title">
        {draft.topic}
      </h2>
      <Actions
        text={text}
        dirty={dirty}
        onSave={saveText}
        onReject={() => void run({ status: 'rejected' }, onChanged)}
      />
      <label className="vh" htmlFor="po-text">
        Текст поста
      </label>
      <textarea className="lk-edit" id="po-text" rows={4} value={text} onChange={edit} />
      <SaveStatus save={save} dirty={dirty} onRetry={() => last.current()} />
    </section>
  );
}
