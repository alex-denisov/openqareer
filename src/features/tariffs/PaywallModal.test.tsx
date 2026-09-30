// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaywallModal } from './PaywallModal';
describe('PaywallModal B318', () => {
  let host: HTMLDivElement; let root: Root;
  const close = vi.fn(); const navigate = vi.fn();
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); close.mockClear(); navigate.mockClear(); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const render = (isOpen = true) => act(() => root.render(<PaywallModal isOpen={isOpen} onClose={close} onNavigate={navigate} />));
  it('renders no closed dialog', () => { render(false); expect(host.textContent).toBe(''); });
  it('describes only available drafts', () => {
    render(); expect(host.textContent).toContain('Черновики комментариев — 3 в день');
    expect(host.textContent).toContain('Черновики постов и комментариев'); expect(host.textContent).not.toContain('Автопилот');
    expect(host.querySelector('[role=dialog]')?.getAttribute('aria-labelledby')).toBe('career-paywall-title');
  });
  it.each(['Pro', 'Executive'])('closes and navigates to tariffs from %s', name => {
    render(); act(() => [...host.querySelectorAll('button')].find(b => b.textContent === `Выбрать ${name}`)!.click());
    expect(close).toHaveBeenCalledOnce(); expect(navigate).toHaveBeenCalledWith('tariffs');
  });
  it('focuses inside, traps Tab, closes with Escape and restores opener', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    render(); const buttons = host.querySelectorAll('button'); expect(document.activeElement).toBe(buttons[0]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(close).toHaveBeenCalledOnce(); render(false); expect(document.activeElement).toBe(opener); opener.remove();
  });
});
