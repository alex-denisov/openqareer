import { CaretRight } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';

export interface FilterOption {
  readonly key: string;
  readonly label: string;
  /** Stage options show how many responses they hold. */
  readonly count?: string;
}

export const FILTER_OPTION_TITLE_ID = 'career-responses-filter-option-title';

/** «Этап · Все ›»: one row of the 390 filter sheet (макет 5, `filters`). */
export function FilterRow({
  rowKey,
  icon,
  label,
  value,
  onOpen,
}: {
  readonly rowKey: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="career-responses-filter-row"
      aria-haspopup="true"
      data-filter-row={rowKey}
      onClick={onOpen}
    >
      <span className="career-responses-filter-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="career-responses-filter-row-label">{label}</span>
      <span className="career-responses-filter-row-value">{value}</span>
      <CaretRight className="career-responses-filter-row-caret" aria-hidden="true" />
    </button>
  );
}

/** One choice of the filter sheet (макет 5, `stagef`): radios, a pick returns to the filters. */
export function FilterOptionSheet({
  title,
  options,
  value,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly options: readonly FilterOption[];
  readonly value: string;
  readonly onPick: (key: string) => void;
  readonly onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);
  return (
    <div className="career-responses-stage-sheet">
      <span className="career-responses-filter-grab" aria-hidden="true" />
      <header className="career-responses-filter-head">
        <h2 id={FILTER_OPTION_TITLE_ID}>{title}</h2>
        <button type="button" className="career-responses-filter-text" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <div
        ref={listRef}
        role="radiogroup"
        aria-labelledby={FILTER_OPTION_TITLE_ID}
        className="career-responses-stage-options"
      >
        {options.map((option) => (
          <FilterOptionRadio
            key={option.key}
            option={option}
            checked={option.key === value}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function FilterOptionRadio({
  option,
  checked,
  onPick,
}: {
  readonly option: FilterOption;
  readonly checked: boolean;
  readonly onPick: (key: string) => void;
}) {
  return (
    <label className="career-responses-stage-option">
      <input
        type="radio"
        name="career-responses-filter-option"
        value={option.key}
        checked={checked}
        onChange={() => onPick(option.key)}
        onClick={() => checked && onPick(option.key)}
      />
      <span className="career-responses-stage-option-label">{option.label}</span>
      {option.count === undefined ? null : (
        <span className="career-responses-stage-option-count">{option.count}</span>
      )}
    </label>
  );
}
