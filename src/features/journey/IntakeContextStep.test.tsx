import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IntakeContextStep, type IntakeContextStepProps } from './IntakeContextStep';

const noop = () => undefined;

function render(patch: Partial<IntakeContextStepProps> = {}): string {
  const props: IntakeContextStepProps = {
    currentSituation: '',
    targetDirection: '',
    regions: [],
    urgency: 'exploring',
    conditions: [],
    otherConstraint: '',
    optional: false,
    onChange: noop,
    ...patch,
  };
  return renderToStaticMarkup(<IntakeContextStep {...props} />);
}

describe('the multi-select chips on the context step', () => {
  /**
   * A tick added inside the chip widens it the moment it is pressed, so the
   * row reflows and the picker jumps under the candidate's cursor
   * (owner report, 2026-08-26). Selection is carried by the material.
   */
  it('does not grow a chip by putting an icon inside it when selected', () => {
    const idle = render();
    const chosen = render({ regions: ['ru'], conditions: ['Только удалённо'] });

    expect(idle).not.toContain('<svg');
    expect(chosen).not.toContain('<svg');
  });

  it('still marks the chosen chips for assistive technology and for the eye', () => {
    const chosen = render({ regions: ['ru'], conditions: ['Только удалённо'] });

    expect(chosen).toContain('class="is-selected" aria-pressed="true"');
  });
});
