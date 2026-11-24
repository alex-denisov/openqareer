import { useEffect, useId, useState } from 'react';
import type { HhResumeEdit, HhResumeEditSection } from '../../../../../shared/hhCandidateSession';
import { Button, Dialog, Icon, SegControl, useToast } from '../../kit';
import { canApply, useHhResumeApply, type HhApplyState, type HhResumeApply } from './useHhResumeApply';

/** B678, A1c: разбор резюме hh.ru — разделы hh.ru, сейчас и предложение платформы. */
const SECTIONS: ReadonlyArray<readonly [HhResumeEditSection, string]> = [
  ['title', 'Должность'],
  ['experience', 'Опыт по местам'],
  ['skills', 'Навыки'],
  ['about', 'О себе'],
];
const COPIED_MS = 2_000;
/** Отклик уходит одним резюме: сверху одно выбранное, переключать не на что. */
const NO_CHANGE = () => undefined;

export function editsWord(count: number): string {
  if (count === 0) return 'Без правок';
  const tens = count % 100;
  const ones = count % 10;
  const word =
    ones === 1 && tens !== 11 ? 'правка' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'правки' : 'правок';
  return `${count} ${word}`;
}

function CopyButton({ text }: { readonly text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    const failed = () => toast.show({ text: 'Не получилось скопировать' });
    try {
      void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(failed);
    } catch {
      failed();
    }
  };
  return (
    <button className="icon-btn" type="button" aria-label={copied ? 'Скопировано' : 'Скопировать'} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

function Lines({ text, className, hidden }: { readonly text: string; readonly className: string; readonly hidden: string }) {
  return (
    <p className={className}>
      <span className="vh">{hidden}</span>
      {text.split('\n').map((line, index) => (
        <span className="hh2-line" key={`${index}-${line.slice(0, 16)}`}>
          {line}
        </span>
      ))}
    </p>
  );
}

function ApplyAction({ edit, state, onApply }: { readonly edit: HhResumeEdit; readonly state: HhApplyState; readonly onApply: () => void }) {
  if (!canApply(edit) || (state.kind === 'failed' && !state.retry)) return null;
  if (state.kind === 'applied') {
    return (
      <span className="tag ok">
        <Icon name="check" /> Изменено на hh.ru
      </span>
    );
  }
  return (
    <Button size="sm" icon="check" busy={state.kind === 'applying'} disabled={state.kind === 'applying'} onClick={onApply}>
      Применить
    </Button>
  );
}

function EditRow({ edit, apply }: { readonly edit: HhResumeEdit; readonly apply: HhResumeApply }) {
  const state = apply.stateOf(edit.id);
  return (
    <li className="hh2-r">
      {edit.place ? <p className="hh2-place">{edit.place}</p> : null}
      {edit.was ? <Lines text={edit.was} className="hh2-was" hidden="Сейчас: " /> : null}
      <div className="hh2-sugg">
        <Lines text={edit.now} className="hh2-now" hidden="Предложение: " />
        <div className="hh2-acts">
          <CopyButton text={edit.now} />
          <ApplyAction edit={edit} state={state} onApply={() => void apply.apply(edit)} />
        </div>
      </div>
      {state.kind === 'failed' ? (
        <p className="hh2-err" role="status">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

function sectionLabel(section: HhResumeEditSection): string {
  return SECTIONS.find(([key]) => key === section)?.[1] ?? '';
}

function ApplyAllDialog({
  open,
  resumeTitle,
  edits,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly resumeTitle: string;
  readonly edits: readonly HhResumeEdit[];
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const footer = (
    <>
      <Button onClick={onCancel}>Отмена</Button>
      <Button variant="primary" onClick={onConfirm}>
        Изменить
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onCancel} title="Изменить резюме на hh.ru?" footer={footer}>
      <p>
        Приложение откроет резюме «{resumeTitle}» в окне hh.ru и изменит: {edits.map((edit) => sectionLabel(edit.section)).join(', ')}.
        Работодатели увидят новый текст.
      </p>
    </Dialog>
  );
}

interface EditsTopProps {
  readonly resumeId: string;
  readonly resumeTitle: string;
  readonly busy: boolean;
  /** `null` — переносить на hh.ru нечего. */
  readonly onApplyAll: (() => void) | null;
}

/** a01c: сверху выбранное резюме и «Применить все на hh.ru». */
function EditsTop({ resumeId, resumeTitle, busy, onApplyAll }: EditsTopProps) {
  const switchName = useId();
  return (
    <div className="hh2-top">
      <SegControl
        label="Резюме hh.ru"
        name={switchName}
        value={resumeId}
        options={[{ value: resumeId, label: resumeTitle }]}
        onChange={NO_CHANGE}
      />
      {onApplyAll ? (
        <div className="actions">
          <Button variant="primary" icon="check" disabled={busy} busy={busy} onClick={onApplyAll}>
            Применить все на hh.ru
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EditSections({ edits, apply }: { readonly edits: readonly HhResumeEdit[]; readonly apply: HhResumeApply }) {
  const groups = SECTIONS.map(([section, label]) => [label, edits.filter((edit) => edit.section === section)] as const)
    .filter(([, items]) => items.length > 0);
  return (
    <>
      {groups.map(([label, items], index) => (
        <section className="hh2-sec" aria-labelledby={`hh2-s${index}`} key={label}>
          <h3 className="mod-title" id={`hh2-s${index}`}>
            {label}
          </h3>
          <ul className="hh2-rows">
            {items.map((edit) => (
              <EditRow edit={edit} apply={apply} key={edit.id} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export interface HhResumeEditsProps {
  readonly resumeId: string;
  readonly resumeTitle: string;
  readonly edits: readonly HhResumeEdit[];
  readonly onBack: () => void;
}

export function HhResumeEdits({ resumeId, resumeTitle, edits, onBack }: HhResumeEditsProps) {
  const apply = useHhResumeApply(resumeId);
  const [confirming, setConfirming] = useState(false);
  const pending = edits.filter((edit) => {
    const state = apply.stateOf(edit.id);
    return canApply(edit) && state.kind !== 'applied' && !(state.kind === 'failed' && !state.retry);
  });
  const confirm = () => {
    setConfirming(false);
    void apply.applyAll(pending);
  };
  return (
    <section className="lead" aria-labelledby="hh2-title">
      <h2 className="lead-title" id="hh2-title">
        Резюме «{resumeTitle}» · {editsWord(edits.length)}
      </h2>
      <EditsTop
        resumeId={resumeId}
        resumeTitle={resumeTitle}
        busy={apply.busy}
        onApplyAll={pending.length > 0 ? () => setConfirming(true) : null}
      />
      <EditSections edits={edits} apply={apply} />
      <div className="actions">
        <Button icon="back" onClick={onBack}>
          К отправке
        </Button>
      </div>
      <ApplyAllDialog
        open={confirming}
        resumeTitle={resumeTitle}
        edits={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      />
    </section>
  );
}
