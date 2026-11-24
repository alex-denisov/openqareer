// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { AnswerDialog } from './AnswerDialog';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function type(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('B659: «Подготовить ответ» без историй', () => {
  it('ответ пишется своими словами; ошибка пустого поля гаснет при вводе', () => {
    const onWrite = vi.fn();
    view = mount(
      <AnswerDialog
        question={{ id: 'q1', title: 'Почему уходите?', ready: false, sub: '' }}
        stories={[]}
        saving={false}
        error={null}
        onPick={vi.fn()}
        onWrite={onWrite}
        onClose={vi.fn()}
      />,
    );
    const save = document.querySelector('.pf-df button') as HTMLButtonElement;
    click(save);
    expect(document.body.textContent).toContain('Напишите ответ');
    type(document.querySelector('textarea') as HTMLTextAreaElement, 'Хочу расти');
    expect(document.body.textContent).not.toContain('Напишите ответ');
    click(save);
    expect(onWrite).toHaveBeenCalledWith('Хочу расти');
  });
});
