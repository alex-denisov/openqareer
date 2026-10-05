// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InterviewDebriefModal,
  type InterviewDebriefSubmitData,
} from './InterviewDebriefModal';

describe('InterviewDebriefModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    vacancyTitle: 'Senior Frontend Developer',
    company: 'ТехноСфера',
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function renderModal(props = defaultProps) {
    await act(async () => {
      root.render(<InterviewDebriefModal {...props} />);
    });
  }

  it('renders modal with feeling, questions, and response deadline fields', async () => {
    await renderModal();

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('Итоги интервью');
    expect(host.textContent).toContain('ТехноСфера');

    expect(host.querySelector('input[value="positive"]')).not.toBeNull();
    expect(host.querySelector('input[value="neutral"]')).not.toBeNull();
    expect(host.querySelector('input[value="difficult"]')).not.toBeNull();
    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.querySelector('input[type="date"]')).not.toBeNull();
  });

  it('selects preset for promised response date and updates input', async () => {
    await renderModal();

    const threeDaysBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('3 рабочих дня'),
    )!;
    expect(threeDaysBtn).toBeDefined();

    await act(async () => {
      threeDaysBtn.click();
    });

    const dateInput = host.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('submits debrief data on save', async () => {
    const onSave = vi.fn();
    await renderModal({ ...defaultProps, onSave });

    // Select feeling
    const positiveRadio = host.querySelector('input[value="positive"]') as HTMLInputElement;
    await act(async () => {
      positiveRadio.click();
    });

    // Fill difficult questions
    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        textarea,
        'Архитектура WebSocket кластера',
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Set promised response date
    const dateInput = host.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        dateInput,
        '2026-10-15',
      );
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Click submit
    const submitBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Сохранить дебрифинг'),
    )!;
    await act(async () => {
      submitBtn.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      feeling: 'positive',
      difficultQuestions: 'Архитектура WebSocket кластера',
      promisedResponseDate: '2026-10-15',
    } satisfies InterviewDebriefSubmitData);
  });

  it('does not render when isOpen is false', async () => {
    await renderModal({ ...defaultProps, isOpen: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
