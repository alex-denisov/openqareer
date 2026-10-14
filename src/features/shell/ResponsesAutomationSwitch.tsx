import { Lightning, Stack } from '@phosphor-icons/react';

export type ResponsesAutomationSegment = 'responses' | 'automation';

export interface ResponsesAutomationSwitchProps {
  readonly active: ResponsesAutomationSegment;
  readonly onSelect: (segment: ResponsesAutomationSegment) => void;
}

/** 390: в «Автоматизации» доступен быстрый переход обратно к воронке. */
export function ResponsesAutomationSwitch({ active, onSelect }: ResponsesAutomationSwitchProps) {
  if (active === 'responses') return null;

  return (
    <div className="career-responses-segment" role="group" aria-label="Раздел откликов">
      <button type="button" aria-pressed={false} onClick={() => onSelect('responses')}>
        <Stack size={18} aria-hidden="true" />
        Воронка
      </button>
      <button type="button" aria-pressed={true} onClick={() => onSelect('automation')}>
        <Lightning size={18} aria-hidden="true" />
        Автоматизация
      </button>
    </div>
  );
}
