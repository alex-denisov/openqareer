import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerTooltip } from './CareerTooltip';

describe('CareerTooltip', () => {
  it('connects the explanation to a keyboard-focusable trigger', () => {
    const html = renderToStaticMarkup(
      <CareerTooltip content="Пояснение к действию">
        <button type="button">Действие</button>
      </CareerTooltip>,
    );

    expect(html).toContain('aria-describedby=');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('Пояснение к действию');
  });

  it('makes non-interactive explanatory labels keyboard discoverable', () => {
    const html = renderToStaticMarkup(
      <CareerTooltip content="Подсказка к числу">
        <span>12 из 12</span>
      </CareerTooltip>,
    );

    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-describedby=');
  });
});
