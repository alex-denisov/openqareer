import { Lightning, Stack } from '@phosphor-icons/react';

export type ResponsesAutomationSegment = 'responses' | 'automation';

export interface ResponsesAutomationSwitchProps {
  readonly active: ResponsesAutomationSegment;
  readonly onSelect: (segment: ResponsesAutomationSegment) => void;
}

/** 390: «Воронка» и «Автоматизация» — два сегмента одного раздела «Отклики» (макет 5). */
export function ResponsesAutomationSwitch({ active, onSelect }: ResponsesAutomationSwitchProps) {
  return (
    <div className="career-responses-segment" role="group" aria-label="Раздел откликов">
      <button
        type="button"
        aria-pressed={active === 'responses'}
        onClick={() => onSelect('responses')}
      >
        <Stack size={18} aria-hidden="true" />
        Воронка
      </button>
      <button
        type="button"
        aria-pressed={active === 'automation'}
        onClick={() => onSelect('automation')}
      >
        <Lightning size={18} aria-hidden="true" />
        Автоматизация
      </button>
    </div>
  );
}
