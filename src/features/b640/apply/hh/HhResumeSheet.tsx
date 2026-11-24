import { useId, useState } from 'react';
import type { HhResumeFit } from '../../../../../shared/hhCandidateSession';
import type { HhResumeItem } from '../../../connections/hhSessionPoll';
import { Button, Dialog, InfoTip, StatusLine } from '../../kit';
import { editsWord } from './HhResumeEdits';
import type { HhResumeVacancyReview } from './hhSessionApi';
import type { HhPicker } from './useHhResumes';

interface ResumeChoicesProps {
  readonly resumes: readonly HhResumeItem[];
  readonly review: HhResumeVacancyReview | null;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly optimize: boolean;
  readonly onOptimize: (optimize: boolean) => void;
}

/** a01b: «N правок» или «Без правок»; разделы не прочитаны — «подходит» или «не хватает: …»; сверка — в ⓘ. Несверенное резюме метки не получает. */
function FitTag({ fit, recommended }: { readonly fit: HhResumeFit | undefined; readonly recommended: boolean }) {
  if (!fit || fit.status === 'unread') return null;
  const fitLabel = fit.status === 'fits' ? 'подходит' : `не хватает: ${fit.missing.join(', ')}`;
  const label = fit.editCount === undefined ? fitLabel : editsWord(fit.editCount);
  const tone = fit.editCount === undefined ? (fit.status === 'fits' ? 'tag ok' : 'tag part') : fit.editCount > 0 ? 'tag part' : 'tag';
  const detail = [
    fit.matched.length > 0 ? `Есть в резюме: ${fit.matched.join(', ')}.` : 'Требований вакансии в резюме нет.',
    fit.missing.length > 0 ? `Нет в резюме: ${fit.missing.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className="hh2-st">
      {recommended ? <span className="tag ok">Рекомендуем</span> : null}
      <span className={tone}>{label}</span>
      <InfoTip label="Сверка с вакансией" text={detail} />
    </span>
  );
}

const editCountOf = (review: HhResumeVacancyReview | null, id: string) =>
  review?.resumes.find((fit) => fit.resumeId === id)?.editCount ?? 0;

function ResumeChoices({ resumes, review, selectedId, onSelect, optimize, onOptimize }: ResumeChoicesProps) {
  const name = useId();
  return (
    <ul className="hh2-picks" aria-label="Резюме на hh.ru">
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
          <FitTag
            fit={review?.resumes.find((fit) => fit.resumeId === resume.id)}
            recommended={review?.recommendedId === resume.id}
          />
          {selectedId === resume.id && editCountOf(review, resume.id) > 0 ? (
            <label className="hh2-opt">
              <input type="checkbox" checked={optimize} onChange={(event) => onOptimize(event.target.checked)} />
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
  readonly optimize: boolean;
  readonly onOptimize: (optimize: boolean) => void;
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
function SheetStop({ picker, onSignIn, onRetry }: Pick<SheetBodyProps, 'picker' | 'onSignIn' | 'onRetry'>) {
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
        review={picker.review}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        optimize={props.optimize}
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
  readonly onChoose: (item: HhResumeItem, optimize: boolean) => void;
}

/** Лист a01b «Какими резюме откликаться»: список из сессии hh.ru кандидата. */
export function HhResumeSheet(props: SheetProps) {
  const { picker, currentId, saving, onClose, onChoose, onRetry } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const [optimize, setOptimize] = useState(true);
  const recommendedId = picker.kind === 'choose' ? (picker.review?.recommendedId ?? null) : null;
  // B678: пока кандидат не выбрал сам, выбрано рекомендованное; без сверки — то, которым он откликается.
  const selectedId = picked ?? recommendedId ?? currentId;
  const chosen = picker.kind === 'choose' ? picker.resumes.find((item) => item.id === selectedId) : undefined;
  const editCount = picker.kind === 'choose' && selectedId ? editCountOf(picker.review, selectedId) : 0;
  const footer =
    picker.kind === 'choose' ? (
      <Button variant="primary" icon="right" busy={saving} disabled={!chosen} onClick={() => chosen && onChoose(chosen, optimize && editCount > 0)}>
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
        optimize={optimize}
        onOptimize={setOptimize}
        onSignIn={props.onSignIn}
        onRetry={onRetry}
      />
    </Dialog>
  );
}
