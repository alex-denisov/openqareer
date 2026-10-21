import { useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';

export interface VacancyPushMoreAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

/** «Ещё» in the 390 push bar (mockup 4, B510): the row's secondary actions
 *  as a sheet, so «вакансия → интервью → подготовка» stays reachable (B286). */
export function VacancyPushMore({
  actions,
}: {
  readonly actions: readonly VacancyPushMoreAction[];
}) {
  const [open, setOpen] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (actions.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="vacancy-push-round"
        aria-label="Ещё"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <>
          <div
            className="vacancy-push-sheet-scrim"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div className="vacancy-push-sheet" role="dialog" aria-modal="true" aria-label="Ещё">
            {actions.map((action, index) => (
              <button
                key={action.label}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className="vacancy-push-sheet-item"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className="vacancy-push-sheet-item is-cancel"
              onClick={() => setOpen(false)}
            >
              Отмена
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
