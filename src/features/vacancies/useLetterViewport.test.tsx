// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { keyboardInsetPx, useAutoGrowTextarea } from './useLetterViewport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('keyboardInsetPx (Д10)', () => {
  it('is zero while the visual viewport fills the layout one', () => {
    expect(keyboardInsetPx(844, { height: 844, offsetTop: 0 })).toBe(0);
  });
  it('is the part of the screen the keyboard covers', () => {
    expect(keyboardInsetPx(844, { height: 508, offsetTop: 0 })).toBe(336);
  });
  it('counts the pan iOS makes on focus', () => {
    expect(keyboardInsetPx(844, { height: 508, offsetTop: 120 })).toBe(216);
  });
  it('ignores toolbar jitter and a missing API', () => {
    expect(keyboardInsetPx(844, { height: 790, offsetTop: 0 })).toBe(0);
    expect(keyboardInsetPx(844, undefined)).toBe(0);
  });
});

describe('useAutoGrowTextarea (Д10)', () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
  });

  let setText: (text: string) => void = () => undefined;
  function Probe() {
    const [text, set] = useState('a');
    setText = set;
    const ref = useRef<HTMLTextAreaElement>(null);
    useAutoGrowTextarea(ref, text);
    return <textarea ref={ref} value={text} readOnly />;
  }

  it('sets the height to the content, so the field never scrolls inside', () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return this.value.length * 10;
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.style.height).toBe('10px');
    act(() => setText('aaaaa'));
    expect(area.style.height).toBe('50px');
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
  });
});
