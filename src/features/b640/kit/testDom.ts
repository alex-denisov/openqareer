import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  readonly container: HTMLElement;
  readonly unmount: () => void;
}

/** Монтирует элемент в `.b640` внутри документа jsdom (только для тестов набора). */
export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  container.className = 'b640';
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function click(element: Element | null): void {
  if (!element) throw new Error('click: элемент не найден');
  act(() => {
    (element as HTMLElement).click();
  });
}

export function press(target: Element | Document, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}
