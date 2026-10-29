// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';
import { ProfileDataDialog } from './ProfileDataDialog';
import type { ProfileDataSection } from './ProfileDataDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

function setup(
  section: ProfileDataSection,
  onSectionSave = vi.fn(async () => true),
  phone?: string,
) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onContactsSaved = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    candidateId: 'c1',
    memory: [],
    onRetry: vi.fn(),
    onDraftChange: vi.fn(),
    onSectionSave,
    draft: {
      candidate: { fullName: 'Тест', ...(phone ? { contact: { phone } } : {}) },
      experience: [],
      education: [],
      languages: [],
    },
    section,
    onSelect,
    onClose,
    onContactsSaved,
  };
  act(() => root.render(<ProfileDataDialog {...props} />));
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, onClose, onSelect, onContactsSaved, onSectionSave };
}

async function clickSave(container: HTMLElement) {
  const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить');
  await act(async () => save?.click());
}

describe('contacts dialog (block A p1: A7-A9, C2)', () => {
  it('is titled «Контакты» even when opened through the name entry', () => {
    const { container } = setup('name');
    expect(container.querySelector('h2')?.textContent).toBe('Контакты');
  });

  it('has no work-preferences panel inside the contacts form', () => {
    const { container } = setup('contacts');
    expect(container.textContent).not.toContain('предпочтений');
  });

  it('closes the whole dialog after a successful save instead of going to the menu', async () => {
    const { container, onSelect, onContactsSaved } = setup('contacts');
    await clickSave(container);
    expect(onContactsSaved).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a plain-Russian error inside the form and stays open', async () => {
    const failing = vi.fn(async () => {
      throw new CoachApiError('blocked by walk', 'http_500', true);
    });
    const { container, onContactsSaved } = setup('contacts', failing);
    await clickSave(container);
    const alert = container.querySelector('form, .career-profile-screen-edit-body [role="alert"]');
    expect(alert?.textContent).toContain('Не сохранилось');
    expect(container.textContent).not.toContain('walk');
    expect(onContactsSaved).not.toHaveBeenCalled();
  });

  it('formats the phone while typing and blocks saving a broken number', async () => {
    const { container, onSectionSave } = setup('contacts');
    const phone = container.querySelector<HTMLInputElement>('input[name="phone"]')!;
    expect(phone.type).toBe('tel');
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')?.type).toBe('email');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(phone, '89991');
      phone.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(phone.value).toBe('+7 999 1');
    await clickSave(container);
    expect(onSectionSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Телефон:');
  });

  it('shows a stored phone already formatted (C1)', () => {
    const { container } = setup('contacts', undefined, '+79651936059');
    const phone = container.querySelector<HTMLInputElement>('input[name="phone"]')!;
    expect(phone.value).toBe('+7 965 193-60-59');
  });
});
