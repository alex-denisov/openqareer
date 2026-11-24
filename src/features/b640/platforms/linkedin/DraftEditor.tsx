import { useRef, useState, type ChangeEvent } from 'react';
import { ResultLine, RowAction, StatusLine, Button } from '../../kit';
import { updateDraft, type LinkedinDraft } from '../../../today/linkedinDraftApi';
import {
  VariantButton,
  VariantSwitch,
  type VariantControlsState,
} from '../../apply/VariantControls';
import { LiError } from './LiError';
import { enqueueDraft } from './linkedinQueueApi';
import { PostTip } from './PostTip';
import { usePostVariants } from './usePostVariants';

type Save = 'idle' | 'busy' | 'done' | 'error';

function Actions({
  variants,
  dirty,
  busy,
  on,
}: {
  readonly variants: VariantControlsState;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly on: {
    readonly approve: () => void;
    readonly save: () => void;
    readonly reject: () => void;
  };
}) {
  return (
    <div className="actions">
      <Button variant="primary" icon="check" disabled={busy} onClick={on.approve}>
        Одобрить и поставить в план
      </Button>
      <VariantButton variants={variants} />
      <VariantSwitch variants={variants} label="Варианты поста" />
      {dirty ? (
        <RowAction type="button" icon="check" onClick={on.save}>
          Сохранить
        </RowAction>
      ) : null}
      <RowAction type="button" onClick={on.reject}>
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

function useDraftActions(
  draft: LinkedinDraft,
  text: string,
  after: { readonly onChanged: () => void; readonly onPlaced: (scheduledAt: string) => void },
) {
  const { onChanged, onPlaced } = after;
  const [save, setSave] = useState<Save>('idle');
  const last = useRef<() => void>(() => undefined);

  async function run(action: () => Promise<void>, done: () => void) {
    last.current = () => void run(action, done);
    setSave('busy');
    try {
      await action();
      done();
    } catch {
      setSave('error');
    }
  }

  const saved = () => {
    setSave('done');
    onChanged();
  };
  const set = async (update: Parameters<typeof updateDraft>[1]) =>
    void (await updateDraft(draft.id, update));
  const approve = async () => {
    if (text !== draft.text) await set({ text });
    await set({ status: 'approved' });
    onPlaced((await enqueueDraft(draft.id)).scheduledAt);
  };
  const on = {
    approve: () => void run(approve, onChanged),
    save: () => void run(() => set({ text }), saved),
    reject: () => void run(() => set({ status: 'rejected' }), onChanged),
  };
  return { save, setSave, on, retry: () => last.current() };
}

/**
 * Текущий черновик: правка текста, «Одобрить и поставить в план», «Другой вариант · N»
 * с листанием вариантов (B694), «Не публиковать».
 * В LinkedIn платформа ничего не отправляет: в назначенное время кандидат публикует сам.
 */
export function DraftEditor({
  draft,
  onChanged,
  onPlaced,
}: {
  readonly draft: LinkedinDraft;
  readonly onChanged: () => void;
  readonly onPlaced: (scheduledAt: string) => void;
}) {
  const [text, setText] = useState(draft.text);
  const dirty = text !== draft.text;
  const actions = useDraftActions(draft, text, { onChanged, onPlaced });
  const { save, on } = actions;
  const variants = usePostVariants(draft.kind, draft.id, { draftText: draft.text, text, setText });
  const edit = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    actions.setSave('idle');
  };

  return (
    <section className="lead" aria-labelledby="po-title">
      <h2 className="po-name" id="po-title">
        {draft.topic}
        <PostTip />
      </h2>
      <Actions variants={variants} dirty={dirty} busy={save === 'busy'} on={on} />
      <label className="vh" htmlFor="po-text">
        Текст поста
      </label>
      <textarea className="lk-edit" id="po-text" rows={4} value={text} onChange={edit} />
      <SaveStatus save={save} dirty={dirty} onRetry={actions.retry} />
    </section>
  );
}
