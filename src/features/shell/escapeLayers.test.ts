// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEscapeLayer } from './escapeLayers';

describe('escapeLayers', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('закрывает слои сверху вниз и не закрывает нижний слой тем же Escape', () => {
    const closed: string[] = [];
    const removePanel = registerEscapeLayer(() => closed.push('panel'));
    const removeDialog = registerEscapeLayer(() => closed.push('dialog'));
    const removeDropdown = registerEscapeLayer(() => closed.push('dropdown'));
    const event = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );

    event();
    removeDropdown();
    event();
    removeDialog();
    event();

    expect(closed).toEqual(['dropdown', 'dialog', 'panel']);
    removePanel();
  });

  it('оставляет Escape нативному выпадающему списку', () => {
    const close = vi.fn();
    const select = document.createElement('select');
    document.body.append(select);
    const removeLayer = registerEscapeLayer(close);

    select.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(close).not.toHaveBeenCalled();
    removeLayer();
  });
});
