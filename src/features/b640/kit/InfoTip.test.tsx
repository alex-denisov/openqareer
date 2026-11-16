// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { click, mount, press, type Mounted } from './testDom';
import { InfoTip } from './InfoTip';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function parts(v: Mounted) {
  const tip = v.container.querySelector('.tip') as HTMLElement;
  const button = tip.querySelector('button.icon-btn.info') as HTMLButtonElement;
  const bubble = tip.querySelector('.tip-bubble') as HTMLElement;
  return { tip, button, bubble };
}

describe('InfoTip', () => {
  it('разметка макета и связи доступности', () => {
    view = mount(<InfoTip label="Кому представить" text="Сергею Белову, CTO" />);
    const { button, bubble } = parts(view);
    expect(button.getAttribute('aria-label')).toBe('Кому представить');
    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(bubble.textContent).toBe('Сергею Белову, CTO');
    expect(button.getAttribute('aria-describedby')).toBe(bubble.id);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('нажатие закрепляет, повторное снимает', () => {
    view = mount(<InfoTip label="Что это" text="Пояснение" />);
    const { tip, button } = parts(view);
    click(button);
    expect(tip.classList.contains('kit-pinned')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    click(button);
    expect(tip.classList.contains('kit-pinned')).toBe(false);
  });
  it('Esc и нажатие мимо закрывают', () => {
    view = mount(<InfoTip label="Что это" text="Пояснение" />);
    const { tip, button } = parts(view);
    click(button);
    press(document, 'Escape');
    expect(tip.classList.contains('kit-pinned')).toBe(false);
    click(button);
    click(document.body);
    expect(tip.classList.contains('kit-pinned')).toBe(false);
  });
});
