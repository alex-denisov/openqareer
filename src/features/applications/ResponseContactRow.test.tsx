// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponseContactRow } from './ResponseContactRow';
import type { ApplicationContact } from './applicationContactApi';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

async function render(
  initial: ApplicationContact | null,
  save: (name: string | null) => Promise<ApplicationContact | null> = vi.fn(),
) {
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    createRoot(root).render(
      <ResponseContactRow load={() => Promise.resolve(initial)} save={save} />,
    );
  });
  return root;
}

function input(root: HTMLElement, value: string) {
  const field = root.querySelector('input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`no button ${label}`);
  return act(async () => button.click());
}

describe('ResponseContactRow (B542)', () => {
  it('shows the vacancy recruiter and lets the candidate name another contact', async () => {
    const save = vi.fn().mockResolvedValue({ name: 'Мария Орлова', source: 'candidate' });
    const root = await render({ name: 'Ольга Белая', source: 'vacancy' }, save);
    expect(root.textContent).toContain('Рекрутер: Ольга Белая · из вакансии');
    await click(root, 'Указать другого');
    input(root, 'Мария Орлова');
    await click(root, 'Сохранить');
    expect(save).toHaveBeenCalledWith('Мария Орлова');
    expect(root.textContent).toContain('Рекрутер: Мария Орлова · добавлен вами');
  });

  it('offers to add a contact when there is none', async () => {
    const root = await render(null);
    expect(root.textContent).toContain('Рекрутер не указан');
    expect(root.textContent).toContain('Добавить');
  });

  it('keeps the form and says so when saving fails', async () => {
    const root = await render(null, vi.fn().mockRejectedValue(new Error('offline')));
    await click(root, 'Добавить');
    input(root, 'Мария Орлова');
    await click(root, 'Сохранить');
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Не удалось сохранить контакт. Попробуйте ещё раз.',
    );
    expect(root.querySelector('input')).not.toBeNull();
  });
});
