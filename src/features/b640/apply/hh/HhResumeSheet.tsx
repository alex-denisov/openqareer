import { useId, useState } from 'react';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { Button, Dialog, StatusLine } from '../../kit';
import { editsWord } from './HhResumeEdits';
import type { HhPicker } from './useHhResumes';

interface ResumeChoicesProps {
  readonly resumes: readonly HhResumeItem[];
  readonly edits: ReadonlyMap<string, number>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly plain: ReadonlySet<string>;
  readonly onOptimize: (id: string, on: boolean) => void;
}

/** a01b: «5 правок» или «Без правок»; правки не посчитаны — метки нет. */
function EditsTag({ count }: { readonly count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="hh2-st">
      <span className={count > 0 ? 'tag part' : 'tag'}>{editsWord(count)}</span>
    </span>
  );
}

function ResumeChoices({
  resumes,
  edits,
  selectedId,
  onSelect,
  plain,
  onOptimize,
}: ResumeChoicesProps) {
  const name = useId();
  return (
    <ul className="hh2-picks" aria-label="Резюме hh.ru">
      {resumes.map((resume) => (
        <li className="hh2-pick" key={resume.id}>
          <label className="vt-opt">
            <input
              type="radio"
              name={name}
              checked={selectedId === resume.id}
              onChange={() => onSelect(resume.id)}
            />
            <span className="vt-opt-t">
              <b>{resume.title}</b>
              {resume.updatedLabel ? <span className="hh2-sub"> · {resume.updatedLabel}</span> : null}
            </span>
          </label>
          <EditsTag count={edits.get(resume.id)} />
          {(edits.get(resume.id) ?? 0) > 0 ? (
            <label className="hh2-opt">
              <input
                type="checkbox"
                checked={!plain.has(resume.id)}
                onChange={(event) => onOptimize(resume.id, event.target.checked)}
              />
              Оптимизировать
            </label>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface SheetBodyProps {
  readonly picker: HhPicker;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly plain: ReadonlySet<string>;
  readonly onOptimize: (id: string, on: boolean) => void;
  readonly onSignIn: () => void;
  readonly onRetry: () => void;
}

function stopLine(picker: HhPicker, onSignIn: () => void) {
  if (picker.kind === 'empty') return <StatusLine state="err" text="На hh.ru у вас нет резюме" />;
  if (picker.kind === 'error') return <StatusLine state="err" text={picker.text} />;
  const signIn = (
    <button className="res-act" type="button" onClick={onSignIn}>
      Войти в hh.ru
    </button>
  );
  return <StatusLine state="err" text="Нужен вход в hh.ru" action={signIn} />;
}

/** Нет входа, нет резюме или сбой: строка состояния и под ней «Прочитать снова». */
function SheetStop({
  picker,
  onSignIn,
  onRetry,
}: Pick<SheetBodyProps, 'picker' | 'onSignIn' | 'onRetry'>) {
  return (
    <div className="hh2-sec">
      {stopLine(picker, onSignIn)}
      <div className="hh2-acts">
        <Button icon="refresh" onClick={onRetry}>
          Прочитать снова
        </Button>
      </div>
    </div>
  );
}

function SheetBody(props: SheetBodyProps) {
  const { picker } = props;
  if (picker.kind === 'reading') return <StatusLine state="wait" text="Читаем резюме в hh.ru" />;
  if (picker.kind === 'choose') {
    return (
      <ResumeChoices
        resumes={picker.resumes}
        edits={picker.edits}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        plain={props.plain}
        onOptimize={props.onOptimize}
      />
    );
  }
  if (picker.kind === 'closed') return null;
  return <SheetStop picker={picker} onSignIn={props.onSignIn} onRetry={props.onRetry} />;
}

interface SheetProps {
  readonly picker: HhPicker;
  readonly currentId: string | null;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSignIn: () => void;
  readonly onRetry: () => void;
  /** `optimize` — у выбранного есть правки и «Оптимизировать» отмечено: дальше разбор правок. */
  readonly onChoose: (item: HhResumeItem, optimize: boolean) => void;
}

/** Лист a01b «Какими резюме откликаться»: список из сессии hh.ru кандидата. */
export function HhResumeSheet(props: SheetProps) {
  const { picker, currentId, saving, onClose, onChoose, onRetry } = props;
  const [picked, setPicked] = useState<string | null>(null);
  // «Оптимизировать» отмечено по умолчанию (a01b); здесь — резюме, у которых его сняли.
  const [plain, setPlain] = useState<ReadonlySet<string>>(new Set());
  const optimizeChange = (id: string, on: boolean) =>
    setPlain(
      (current) => new Set([...current].filter((item) => item !== id).concat(on ? [] : [id])),
    );
  const recommendedId = picker.kind === 'choose' ? (picker.review?.recommendedId ?? null) : null;
  // B678: пока кандидат не выбрал сам, выбрано рекомендованное; без сверки — то, которым он откликается.
  const selectedId = picked ?? recommendedId ?? currentId;
  const chosen = picker.kind === 'choose' ? picker.resumes.find((item) => item.id === selectedId) : undefined;
  const footer =
    picker.kind === 'choose' ? (
      <Button
        variant="primary"
        busy={saving}
        disabled={!chosen}
        onClick={() =>
          chosen &&
          onChoose(chosen, (picker.edits.get(chosen.id) ?? 0) > 0 && !plain.has(chosen.id))
        }
      >
        Продолжить
      </Button>
    ) : undefined;
  return (
    <Dialog
      open={picker.kind !== 'closed'}
      onClose={onClose}
      title="Каким резюме откликаться"
      className="hh2-sheet"
      footer={footer}
    >
      <SheetBody
        picker={picker}
        selectedId={selectedId}
        onSelect={setPicked}
        plain={plain}
        onOptimize={optimizeChange}
        onSignIn={props.onSignIn}
        onRetry={onRetry}
      />
    </Dialog>
  );
}
