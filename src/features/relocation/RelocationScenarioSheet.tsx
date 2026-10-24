import { useEffect, useRef } from 'react';
import type { MobilityScenarioId } from '../../../shared/countryFit/types';
import { RELOCATION_SCENARIO_LABELS } from './relocationCountrySummary';

export type RelocationScenarioFilter = 'all' | MobilityScenarioId;

const OPTIONS: readonly RelocationScenarioFilter[] = [
  'all',
  'domestic_market',
  'employer_sponsorship',
  'digital_nomad',
  'simple_mobility',
];

/** Mockup 15 `sheet=rls`: the scenario filter as radio rows in a modal bottom sheet (Escape closes it). */
export function RelocationScenarioSheet({
  value,
  onChange,
  onClose,
}: {
  readonly value: RelocationScenarioFilter;
  readonly onChange: (value: RelocationScenarioFilter) => void;
  readonly onClose: () => void;
}) {
  const ref = useModalDialog();
  return (
    <dialog
      ref={ref}
      className="career-relocation-sheet"
      aria-labelledby="career-relocation-sheet-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <span className="career-relocation-sheet-grab" aria-hidden="true" />
      <header>
        <h3 id="career-relocation-sheet-title">Сценарий</h3>
        <button className="career-relocation-sheet-close" type="button" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <div
        className="career-relocation-mobile-rows"
        role="radiogroup"
        aria-label="Сценарий переезда"
      >
        {OPTIONS.map((option) => (
          <label key={option} className="career-relocation-sheet-option">
            <input
              type="radio"
              name="relocation-scenario-filter"
              checked={value === option}
              onChange={() => {
                onChange(option);
                onClose();
              }}
            />
            <span>{option === 'all' ? 'Все' : (RELOCATION_SCENARIO_LABELS[option] ?? option)}</span>
          </label>
        ))}
      </div>
    </dialog>
  );
}

/** Opens the native dialog as modal: focus trap and Escape come from the platform. */
function useModalDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }, []);
  return ref;
}
