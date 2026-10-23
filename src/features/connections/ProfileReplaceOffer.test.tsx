// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileReplaceOffer } from './ProfileReplaceOffer';

describe('ProfileReplaceOffer', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('names both platforms and replaces only on an explicit click', () => {
    const onReplace = vi.fn();
    act(() => root.render(<ProfileReplaceOffer platform="hh" busy={false} onReplace={onReplace} />));

    expect(host.textContent).toContain('Профиль собран из LinkedIn и не изменился');
    expect(onReplace).not.toHaveBeenCalled();
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Заменить профиль данными с hh.ru');
    act(() => button?.click());
    expect(onReplace).toHaveBeenCalledOnce();
  });

  it('cannot be pressed twice while the replacement runs', () => {
    act(() => root.render(<ProfileReplaceOffer platform="linkedin" busy onReplace={vi.fn()} />));

    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Заменяем…');
    expect(button?.disabled).toBe(true);
  });
});
