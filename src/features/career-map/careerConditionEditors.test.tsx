// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEscapeLayer } from '../shell/escapeLayers';
import { CareerInlineGeoEditor, CareerInlineSalaryEditor } from './CareerConditionsComponents';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('редактор условия «Карьеры»: Enter и Escape (B445-r1)', () => {
  it('Enter в поле зарплаты сохраняет так же, как галочка', () => {
    const onSave = vi.fn();
    const node = mount(
      <CareerInlineSalaryEditor
        initialSalary={null}
        initialShowWithoutSalary={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = node.querySelector<HTMLInputElement>('#salary-input')!;
    press(input, 'Enter');
    expect(onSave).toHaveBeenCalledWith(null, false);
  });

  it('Escape отменяет правку и не закрывает консультанта под редактором', () => {
    const closeConsultant = vi.fn();
    const unregister = registerEscapeLayer(closeConsultant);
    const onCancel = vi.fn();
    const node = mount(
      <CareerInlineGeoEditor initialSelected={['Москва']} onSave={vi.fn()} onCancel={onCancel} />,
    );
    press(node.querySelector('#geo-input')!, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(closeConsultant).not.toHaveBeenCalled();
    unregister();
  });
});
