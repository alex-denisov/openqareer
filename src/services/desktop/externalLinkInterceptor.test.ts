// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installExternalLinkInterceptor } from './externalLinkInterceptor';

function clickLink(attrs: Record<string, string>): MouseEvent {
  const link = document.createElement('a');
  for (const [key, value] of Object.entries(attrs)) link.setAttribute(key, value);
  link.textContent = 'x';
  document.body.appendChild(link);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  return event;
}

describe('installExternalLinkInterceptor (B331)', () => {
  let uninstall: () => void = () => {};
  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  it('routes a target=_blank web link to the system browser', () => {
    const open = vi.fn().mockResolvedValue(true);
    uninstall = installExternalLinkInterceptor(document, open);
    const event = clickLink({ href: 'https://hh.ru/vacancy/1', target: '_blank' });
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://hh.ru/vacancy/1');
  });

  it('leaves in-app links and non-web schemes alone', () => {
    const open = vi.fn().mockResolvedValue(true);
    uninstall = installExternalLinkInterceptor(document, open);
    expect(clickLink({ href: '/profile' }).defaultPrevented).toBe(false);
    expect(clickLink({ href: 'mailto:a@b.c', target: '_blank' }).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('respects a handler that already took the click', () => {
    const open = vi.fn().mockResolvedValue(true);
    uninstall = installExternalLinkInterceptor(document, open);
    document.body.addEventListener('click', (e) => e.preventDefault(), { capture: true });
    clickLink({ href: 'https://hh.ru/vacancy/2', target: '_blank' });
    expect(open).not.toHaveBeenCalled();
  });
});
