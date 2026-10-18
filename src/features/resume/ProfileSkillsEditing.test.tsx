// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileSkillsSection } from './ProfileSkillsSection';
import type { ResumeDraft } from './resumeTypes';

const draft: ResumeDraft = {
  candidate: { fullName: 'Тестовый кандидат' },
  experience: [],
  education: [],
  languages: [],
  skills: [{ id: 'skill-1', name: 'TypeScript' }],
};
const disposers: Array<() => void> = [];

afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const save = vi.fn<(next: ResumeDraft) => Promise<boolean>>().mockResolvedValue(false);
  act(() => root.render(<ProfileSkillsSection draft={draft} onSectionSave={save} />));
  disposers.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, save };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  expect(element).toBeDefined();
  return element as HTMLButtonElement;
}

function setInputValue(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ProfileSkillsSection editing', () => {
  it('keeps skill removals local until Save and discards them on Cancel', () => {
    const { container, save } = render();
    act(() => button(container, 'Изменить навыки').click());
    act(() => button(container, 'Удалить навык TypeScript').click());

    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('TypeScript');
    act(() => button(container, 'Отменить').click());
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain('TypeScript');
  });

  it('keeps the new skill in the editor when the server rejects the save', async () => {
    const { container, save } = render();
    act(() => button(container, 'Изменить навыки').click());
    const field = container.querySelector<HTMLInputElement>('input');
    expect(field).not.toBeNull();
    setInputValue(field!, 'Rust');

    await act(async () => button(container, 'Сохранить').click());

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].skills?.map((skill) => skill.name)).toEqual([
      'TypeScript',
      'Rust',
    ]);
    expect(container.querySelector('input')?.value).toBe('Rust');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('does not send an unchanged draft to the save API', async () => {
    const { container, save } = render();
    act(() => button(container, 'Изменить навыки').click());
    await act(async () => button(container, 'Сохранить').click());

    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
