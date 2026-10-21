import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
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

/** Mockup 15 `sheet=rls`: the scenario filter as a modal bottom sheet (Escape closes it). */
export function RelocationScenarioSheet({ value, onChange, onClose }: {
  readonly value: RelocationScenarioFilter;
  readonly onChange: (value: RelocationScenarioFilter) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="career-relocation-sheet" aria-labelledby="career-relocation-sheet-title" onClose={onClose} onCancel={onClose}>
      <header>
        <h3 id="career-relocation-sheet-title">Сценарий переезда</h3>
        <button className="career-relocation-icon-button" type="button" aria-label="Закрыть" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </header>
      <div className="career-relocation-chips" role="group" aria-label="Сценарий переезда">
        {OPTIONS.map((option) => (
          <button
            key={option}
            className="career-relocation-filter-chip"
            type="button"
            aria-pressed={value === option}
            onClick={() => { onChange(option); onClose(); }}
          >
            {option === 'all' ? 'Все' : RELOCATION_SCENARIO_LABELS[option] ?? option}
          </button>
        ))}
      </div>
    </dialog>
  );
}
