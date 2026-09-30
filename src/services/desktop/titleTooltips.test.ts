// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installTitleTooltips } from './titleTooltips';

function tip(): HTMLElement | null {
  return document.querySelector('.oq-title-tip');
}

describe('installTitleTooltips (B331)', () => {
  let uninstall: () => void = () => {};
  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  it('shows the title text on hover and restores the attribute on leave', () => {
    uninstall = installTitleTooltips(document);
    const button = document.createElement('button');
    button.title = 'Роль: совпадает';
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()?.textContent).toBe('Роль: совпадает');
    expect(tip()?.hidden).toBe(false);
    expect(button.getAttribute('title')).toBeNull();

    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(tip()?.hidden).toBe(true);
    expect(button.getAttribute('title')).toBe('Роль: совпадает');
  });

  it('also opens on click so the ⓘ button does something', () => {
    uninstall = installTitleTooltips(document);
    const button = document.createElement('button');
    button.title = 'Порядок задаёт сервер';
    document.body.appendChild(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tip()?.textContent).toBe('Порядок задаёт сервер');
  });

  it('ignores elements without a title', () => {
    uninstall = installTitleTooltips(document);
    const span = document.createElement('span');
    document.body.appendChild(span);
    span.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(tip()?.hidden ?? true).toBe(true);
  });
});
