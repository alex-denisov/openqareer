// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ answerEmployerName: vi.fn() }));
vi.mock('./employerNameApi', () => api);

import { ProfileEmployerName } from './ProfileEmployerName';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const MASK = 'Enterprise Energy IT Services';
const cleanups: (() => void)[] = [];

async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  api.answerEmployerName.mockReset();
});

describe('ProfileEmployerName (B639)', () => {
  it('у настоящего названия вопроса нет', async () => {
    const container = await render(<ProfileEmployerName place={{ employer: 'Россети Цифра' }} />);
    expect(container.textContent).toBe('');
  });

  it('у маски спрашивает название и сохраняет его', async () => {
    api.answerEmployerName.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const container = await render(
      <ProfileEmployerName place={{ employer: MASK }} onChanged={onChanged} />,
    );
    expect(container.textContent).toContain('Как называется эта компания на самом деле?');
    await type(container.querySelector('input')!, ' Россети Цифра ');
    await act(async () => button(container, 'Сохранить').click());
    expect(api.answerEmployerName).toHaveBeenCalledWith(
      MASK,
      { name: 'Россети Цифра' },
      expect.any(String),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('пустое название не отправляет и подсвечивает поле', async () => {
    const container = await render(<ProfileEmployerName place={{ employer: MASK }} />);
    await act(async () => button(container, 'Сохранить').click());
    expect(api.answerEmployerName).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Напишите название компании.',
    );
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('«Это и есть название» снимает вопрос', async () => {
    api.answerEmployerName.mockResolvedValue(undefined);
    const container = await render(<ProfileEmployerName place={{ employer: MASK }} />);
    await act(async () => button(container, 'Это и есть название').click());
    expect(api.answerEmployerName).toHaveBeenCalledWith(
      MASK,
      { keepAsIs: true },
      expect.any(String),
    );
  });

  it('ошибка сервера видна, введённое остаётся', async () => {
    api.answerEmployerName.mockRejectedValue(
      new Error('Место работы изменилось. Обновите профиль и повторите.'),
    );
    const container = await render(<ProfileEmployerName place={{ employer: MASK }} />);
    await type(container.querySelector('input')!, 'Россети Цифра');
    await act(async () => button(container, 'Сохранить').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Место работы изменилось',
    );
    expect(container.querySelector('input')?.value).toBe('Россети Цифра');
  });

  it('сохранённое название можно изменить или убрать', async () => {
    api.answerEmployerName.mockResolvedValue(undefined);
    const container = await render(
      <ProfileEmployerName place={{ employer: MASK, employerRealName: 'Россети' }} />,
    );
    expect(container.textContent).toContain('Настоящее название: Россети');
    await act(async () => button(container, 'Изменить').click());
    expect(container.querySelector('input')?.value).toBe('Россети');
    await act(async () => button(container, 'Отмена').click());
    await act(async () => button(container, 'Убрать').click());
    expect(api.answerEmployerName).toHaveBeenCalledWith(
      MASK,
      { keepAsIs: true },
      expect.any(String),
    );
  });

  it('ответ «это и есть название» вопрос больше не показывает', async () => {
    const container = await render(
      <ProfileEmployerName place={{ employer: MASK, employerMaskKept: true }} />,
    );
    expect(container.textContent).toBe('');
  });
});
