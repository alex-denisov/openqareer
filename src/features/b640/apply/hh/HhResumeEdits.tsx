import { useCallback, useEffect, useId, useState } from 'react';
import type { HhResumeEdit, HhResumeEditSection } from '../../../../../shared/hhCandidateSession';
import { Button, Dialog, Icon, SegControl, useToast } from '../../kit';
import { HhEditVariantButton, HhEditVariantError, HhEditVariantSwitch } from '../HhEditVariant';
import { useHhEditVariants } from '../useHhEditVariants';
import { showHhCaptcha } from './hhDesktop';
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

function ApplyAction({ edit, state, busy, onApply }: { readonly edit: HhResumeEdit; readonly state: HhApplyState; readonly busy: boolean; readonly onApply: () => void }) {
  if (!canApply(edit) || (state.kind === 'failed' && !state.retry)) return null;
  if (state.kind === 'applied') {
    return (
      <span className="tag ok">
        <Icon name="check" /> Изменено на hh.ru
      </span>
    );
  }
  return (
    <Button size="sm" icon="check" busy={state.kind === 'applying'} disabled={busy || state.kind === 'applying'} onClick={onApply}>
      Применить
    </Button>
  );
}

interface EditRowProps {
  readonly canWrite: boolean;
  readonly edit: HhResumeEdit;
  /** Правка с выбранным вариантом текста: она и копируется, и применяется. */
  readonly shown: HhResumeEdit;
  readonly apply: HhResumeApply;
  readonly onShow: (edit: HhResumeEdit) => void;
}

function EditRow({ canWrite, edit, shown, apply, onShow }: EditRowProps) {
  const state = apply.stateOf(edit.id);
  const variants = useHhEditVariants(edit, shown, onShow);
  // Текст, который уже переносится или перенесён на hh.ru, не меняем.
  const settled = apply.busy || state.kind === 'applied';
  return (
    <li className="hh2-r">
      {edit.place ? <p className="hh2-place">{edit.place}</p> : null}
      {edit.was ? <Lines text={edit.was} className="hh2-was" hidden="Сейчас: " /> : null}
      <div className="hh2-sugg">
        <Lines text={shown.now} className="hh2-now" hidden="Предложение: " />
        <HhEditVariantSwitch variants={variants} disabled={settled} />
        <div className="hh2-acts">
          <CopyButton text={shown.now} />
          {edit.variantOf ? <HhEditVariantButton variants={variants} disabled={settled} /> : null}
          {canWrite ? (
            <ApplyAction edit={shown} state={state} busy={variants.busy} onApply={() => void apply.apply(shown)} />
          ) : null}
        </div>
      </div>
      <HhEditVariantError variants={variants} />
      {state.kind === 'failed' ? (
        <p className="hh2-err" role="status">
          {state.message}
          {state.captcha ? (
            <button className="res-act" type="button" onClick={() => void showHhCaptcha()}>
              Открыть окно hh.ru
            </button>
          ) : null}
        </p>
      ) : null}
    </li>
  );
}

function ApplyAllDialog({
  open,
  resumeTitle,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly resumeTitle: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const footer = (
    <>
      <Button variant="primary" icon="check" onClick={onConfirm}>
        Применить
      </Button>
      <Button variant="quiet" onClick={onCancel}>
        Отмена
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onCancel} title="Применить все на hh.ru?" footer={footer}>
      <p className="hh-ok-d">Резюме «{resumeTitle}» изменится на hh.ru для всех работодателей.</p>
    </Dialog>
  );
}

interface EditsTopProps {
  readonly switcher: boolean;
  readonly resumeId: string;
  readonly resumeTitle: string;
  readonly busy: boolean;
  /** `null` — переносить на hh.ru нечего. */
  readonly onApplyAll: (() => void) | null;
}

/** a01c: сверху выбранное резюме и «Применить все на hh.ru». */
function EditsTop({ switcher, resumeId, resumeTitle, busy, onApplyAll }: EditsTopProps) {
  const switchName = useId();
  if (!switcher && !onApplyAll) return null;
  return (
    <div className="hh2-top">
      {switcher ? (
        <SegControl
          label="Резюме hh.ru"
          name={switchName}
          value={resumeId}
          options={[{ value: resumeId, label: resumeTitle }]}
          onChange={NO_CHANGE}
        />
      ) : null}
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

interface EditSectionsProps {
  readonly canWrite: boolean;
  readonly edits: readonly HhResumeEdit[];
  readonly shownOf: (edit: HhResumeEdit) => HhResumeEdit;
  readonly apply: HhResumeApply;
  readonly onShow: (edit: HhResumeEdit) => void;
}

function EditSections({ canWrite, edits, shownOf, apply, onShow }: EditSectionsProps) {
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
              <EditRow canWrite={canWrite} edit={edit} shown={shownOf(edit)} apply={apply} onShow={onShow} key={edit.variantOf?.subjectId ?? edit.id} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Выбор держится за содержимым правки: новый разбор того же места прежний вариант не подставит. */
const choiceKey = (edit: HhResumeEdit) => edit.variantOf?.subjectId ?? edit.id;

export interface HhEditsListProps {
  readonly resumeId: string;
  readonly resumeTitle: string;
  readonly edits: readonly HhResumeEdit[];
  /** На hh.ru правит только приложение. */
  readonly canWrite?: boolean;
  /** Строка выбранного резюме сверху (a01c); на шаге «Резюме» её место занимает выбор. */
  readonly switcher?: boolean;
}

/** Правки по разделам с переносом на hh.ru. */
export function HhEditsList({ resumeId, resumeTitle, edits, canWrite = true, switcher = false }: HhEditsListProps) {
  const apply = useHhResumeApply(resumeId);
  const [confirming, setConfirming] = useState(false);
  const [chosen, setChosen] = useState<Readonly<Record<string, HhResumeEdit>>>({});
  const show = useCallback((edit: HhResumeEdit) => setChosen((current) => ({ ...current, [choiceKey(edit)]: edit })), []);
  const shownOf = (edit: HhResumeEdit) => chosen[choiceKey(edit)] ?? edit;
  const pending = edits.map(shownOf).filter((edit) => {
    const state = apply.stateOf(edit.id);
    return canApply(edit) && state.kind !== 'applied' && !(state.kind === 'failed' && !state.retry);
  });
  const confirm = () => {
    setConfirming(false);
    void apply.applyAll(pending);
  };
  return (
    <>
      <EditsTop
        switcher={switcher}
        resumeId={resumeId}
        resumeTitle={resumeTitle}
        busy={apply.busy}
        onApplyAll={canWrite && pending.length > 0 ? () => setConfirming(true) : null}
      />
      <EditSections canWrite={canWrite} edits={edits} shownOf={shownOf} apply={apply} onShow={show} />
      <ApplyAllDialog
        open={confirming}
        resumeTitle={resumeTitle}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      />
    </>
  );
}

export interface HhResumeEditsProps extends Pick<HhEditsListProps, 'resumeId' | 'resumeTitle' | 'edits'> {
  readonly onBack: () => void;
}

export function HhResumeEdits({ resumeId, resumeTitle, edits, onBack }: HhResumeEditsProps) {
  return (
    <section className="lead" aria-labelledby="hh2-title">
      <h2 className="lead-title" id="hh2-title">
        Резюме «{resumeTitle}» · {editsWord(edits.length)}
      </h2>
      <HhEditsList resumeId={resumeId} resumeTitle={resumeTitle} edits={edits} switcher />
      <div className="actions">
        <Button icon="back" onClick={onBack}>
          К отправке
        </Button>
      </div>
    </section>
  );
}
