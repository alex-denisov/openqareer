// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, press, type Mounted } from './testDom';
import { ToastHost, useToast, type ToastOptions } from './Toast';

let view: Mounted | null = null;
let show: (options: ToastOptions) => void = () => undefined;

function Probe() {
  show = useToast().show;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  view = mount(
    <>
      <Probe />
      <ToastHost />
    </>,
  );
});
afterEach(() => {
  view?.unmount();
  vi.useRealTimers();
});

const snack = () => view?.container.querySelector('.va-snack') ?? null;

describe('Toast', () => {
  it('область вживую есть всегда, тост появляется внутри неё', () => {
    const region = view?.container.querySelector('[role=status][aria-live=polite]');
    expect(region).not.toBeNull();
    expect(snack()).toBeNull();
    act(() => show({ text: 'Скрыто' }));
    expect(region?.querySelector('.va-snack')?.textContent).toBe('Скрыто');
  });
  it('«Отменить» вызывает onUndo и закрывает', () => {
    const onUndo = vi.fn();
    act(() => show({ text: 'Скрыто', undo: { label: 'Отменить', onUndo } }));
    const button = snack()?.querySelector('button.row-act.va-undo');
    expect(button?.textContent).toBe('Отменить');
    click(button ?? null);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(snack()).toBeNull();
  });
  it('исчезает по таймеру', () => {
    act(() => show({ text: 'Скрыто', timeoutMs: 3000 }));
    act(() => void vi.advanceTimersByTime(2999));
    expect(snack()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(snack()).toBeNull();
  });
  it('Esc закрывает; один тост за раз', () => {
    act(() => show({ text: 'Первый' }));
    act(() => show({ text: 'Второй' }));
    expect(view?.container.querySelectorAll('.va-snack')).toHaveLength(1);
    expect(snack()?.textContent).toBe('Второй');
    press(document, 'Escape');
    expect(snack()).toBeNull();
  });
});
