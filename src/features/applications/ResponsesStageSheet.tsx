import { CaretRight, Funnel } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';

export interface StageSheetItem {
  /** Summary key from the 1440 funnel summary («все», «нужно действие», …). */
  readonly key: string;
  readonly count: string;
}

export const STAGE_SHEET_TITLE_ID = 'career-responses-stage-title';

function stageLabel(key: string): string {
  return key.charAt(0).toLocaleUpperCase('ru-RU') + key.slice(1);
}

/** «Этап · Все ›» row of the 390 filter sheet (макет 5, `filters`). */
export function StageSheetRow({
  value,
  onOpen,
}: {
  readonly value: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="career-responses-filter-row"
      aria-haspopup="true"
      data-stage-row=""
      onClick={onOpen}
    >
      <span className="career-responses-filter-row-icon" aria-hidden="true">
        <Funnel />
      </span>
      <span className="career-responses-filter-row-label">Этап</span>
      <span className="career-responses-filter-row-value">{stageLabel(value)}</span>
      <CaretRight className="career-responses-filter-row-caret" aria-hidden="true" />
    </button>
  );
}

/** Stage choice sheet (макет 5, `stagef`): one radio per summary filter with its count. */
export function StageSheet({
  items,
  value,
  onPick,
  onClose,
}: {
  readonly items: readonly StageSheetItem[];
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
      <header className="career-responses-filter-head">
        <h2 id={STAGE_SHEET_TITLE_ID}>Этап</h2>
        <button
          type="button"
          className="career-btn career-btn-ghost career-btn-sm"
          onClick={onClose}
        >
          Закрыть
        </button>
      </header>
      <div
        ref={listRef}
        role="radiogroup"
        aria-labelledby={STAGE_SHEET_TITLE_ID}
        className="career-responses-stage-options"
      >
        {items.map((item) => (
          <StageOption key={item.key} item={item} checked={item.key === value} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function StageOption({
  item,
  checked,
  onPick,
}: {
  readonly item: StageSheetItem;
  readonly checked: boolean;
  readonly onPick: (key: string) => void;
}) {
  return (
    <label className="career-responses-stage-option">
      <input
        type="radio"
        name="career-responses-stage"
        value={item.key}
        checked={checked}
        onChange={() => onPick(item.key)}
        onClick={() => checked && onPick(item.key)}
      />
      <span className="career-responses-stage-option-label">{stageLabel(item.key)}</span>
      <span className="career-responses-stage-option-count">{item.count}</span>
    </label>
  );
}
