import type { ReactNode } from 'react';
import { CaretLeft, CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react';
import type { CountrySelectionSave } from './useSavedCountrySelection';

export interface RelocationHeaderCardProps {
  readonly title: string;
  readonly status: 'on' | 'off';
  readonly description: string;
  readonly backLabel: string;
  readonly onBack: () => void;
  /** Server state of the country choice, shown on the right of the title row. */
  readonly selectionSave?: CountrySelectionSave;
  readonly children?: ReactNode;
}

/** The framed head of mockup 15: back, title, state badge, one line of context, tabs. */
export function RelocationHeaderCard({
  title,
  status,
  description,
  backLabel,
  onBack,
  selectionSave,
  children,
}: RelocationHeaderCardProps) {
  return (
    <header className="career-relocation-card career-relocation-header">
      <div className="career-relocation-title-row">
        <button
          className="career-relocation-back"
          type="button"
          aria-label={backLabel}
          onClick={onBack}
        >
          <CaretLeft aria-hidden="true" size={20} />
        </button>
        <h2 id="career-relocation-title">{title}</h2>
        <span className={`career-relocation-status${status === 'on' ? ' is-enabled' : ''}`}>
          {status === 'on' ? (
            <CheckCircle aria-hidden="true" size={14} />
          ) : (
            <Circle aria-hidden="true" size={12} />
          )}
          {status === 'on' ? 'Включено' : 'Не включено'}
        </span>
        <SelectionSaveNote save={selectionSave} />
      </div>
      <p>{description}</p>
      {children}
    </header>
  );
}

const SAVE_TEXT: Readonly<Record<CountrySelectionSave, string>> = {
  saved: 'Выбор сохраняется',
  saving: 'Сохраняем выбор…',
  error: 'Выбор не сохранён, повторите',
};

function SelectionSaveNote({ save }: { readonly save?: CountrySelectionSave }) {
  if (!save) return null;
  const Icon = save === 'error' ? WarningCircle : CheckCircle;
  return (
    <span
      className={`career-relocation-save-note${save === 'error' ? ' is-error' : ''}`}
      role={save === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" size={16} />
      {SAVE_TEXT[save]}
    </span>
  );
}
