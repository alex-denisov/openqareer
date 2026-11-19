import { useRef, useState } from 'react';
import { Icon, ResultLine, RowAction, StatusLine } from '../../kit';
import { updateDraft, type LinkedinDraft } from '../../../today/linkedinDraftApi';
import { CopyButton } from './CopyButton';

type Save = 'idle' | 'busy' | 'done' | 'error';

/** Текущий черновик: правка текста, «Скопировать», «Не публиковать». Публикации на площадке нет. */
export function DraftEditor({ draft, onChanged }: {
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

  return (
    <section className="lead" aria-labelledby="po-title">
      <h2 className="po-name" id="po-title">{draft.topic}</h2>
      <div className="actions">
        <CopyButton text={text} label="пост" caption="Скопировать" />
        {dirty ? (
          <RowAction type="button" icon="check" onClick={() => void run({ text }, () => { setSave('done'); onChanged(); })}>
            Сохранить
          </RowAction>
        ) : null}
        <RowAction type="button" onClick={() => void run({ status: 'rejected' }, onChanged)}>Не публиковать</RowAction>
      </div>
      <label className="vh" htmlFor="po-text">Текст поста</label>
      <textarea className="lk-edit" id="po-text" rows={4} value={text} onChange={(event) => { setText(event.target.value); setSave('idle'); }} />
      {save === 'busy' ? <StatusLine state="wait" text="Сохраняем…" /> : null}
      {save === 'done' && !dirty ? <ResultLine text="Сохранено" /> : null}
      {save === 'error' ? (
        <p className="li-err" role="alert">
          <Icon name="warn" />
          Не удалось сохранить
          <button className="row-act" type="button" onClick={() => last.current()}>
            <Icon name="repeat" />
            Повторить
          </button>
        </p>
      ) : null}
    </section>
  );
}
