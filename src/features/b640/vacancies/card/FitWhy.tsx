import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitSentence } from '../../../vacancies/vacancyFitModel';
import { Icon } from '../../kit';
import { listedRows, sourceLine } from './fitRows';
import { RequirementList } from './RequirementList';

export interface FitWhyProps {
  readonly percent: number;
  readonly view: VacancyFitView;
  readonly sourceName: string;
}

interface FitDialogProps {
  readonly dialogRef: RefObject<HTMLDivElement>;
  readonly id: string;
  readonly percent: number;
  readonly view: VacancyFitView;
  readonly sourceName: string;
  readonly open: boolean;
  readonly onClose: () => void;
}

function FitDialog({ dialogRef, id, percent, view, sourceName, open, onClose }: FitDialogProps) {
  const titleId = `${id}-t`;
  return (
      <div
        ref={dialogRef}
        className="v4-fd"
        id={id}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        hidden={!open}
      >
        <div className="v4-fd-h">
          <h3 id={titleId}>Совпадение {percent} %</h3>
          <button className="icon-btn v4-fd-x" type="button" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="v4-fd-b">
          <p className="v4-fd-v">{vacancyFitSentence(view)}</p>
          <RequirementList rows={listedRows(view)} />
        </div>
        <p className="v4-fd-src">{sourceLine(view, sourceName)}</p>
        <div className="v4-fd-f">
          <button className="btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
  );
}

/** ⓘ «Почему N %» и окно с выводом, требованиями и источником. Закрывается по Esc. */
export function FitWhy({ percent, view, sourceName }: FitWhyProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="v4-src v4-src-fit">
      <button
        ref={button}
        className="icon-btn info"
        type="button"
        aria-label={`Почему ${percent} %`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="info" />
      </button>
      <span className="v4-fd-scrim" aria-hidden="true" onClick={close} />
      <FitDialog
        dialogRef={dialog}
        id={id}
        percent={percent}
        view={view}
        sourceName={sourceName}
        open={open}
        onClose={close}
      />
    </span>
  );
}
