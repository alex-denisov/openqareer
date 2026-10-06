// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyReminderModal } from './CompanyReminderModal';

describe('CompanyReminderModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onMarkSent: vi.fn(),
    applicationId: 'app-1',
    company: 'ТехноСфера',
    positionTitle: 'Senior Frontend Developer',
    promisedDate: '2026-10-06',
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function renderModal(props = defaultProps) {
    await act(async () => {
      root.render(<CompanyReminderModal {...props} />);
    });
  }

  it('renders modal with title Напоминание компании and draft text', async () => {
    await renderModal();

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('Напоминание компании');
    expect(host.textContent).toContain('ТехноСфера');
    expect(host.textContent).toContain('Senior Frontend Developer');
    expect(host.textContent).toContain('OpenQareer не отправляет сообщения без вашего ведома');

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain('ТехноСфера');
    expect(textarea?.value).toContain('Senior Frontend Developer');
  });

  it('copies draft text to clipboard and shows copied feedback', async () => {
    await renderModal();

    const copyBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Скопировать черновик'),
    )!;
    expect(copyBtn).toBeDefined();

    await act(async () => {
      copyBtn.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(host.textContent).toContain('Скопировано');
  });

  it('marks reminder sent when clicking Отметить отправленным', async () => {
    const onMarkSent = vi.fn().mockResolvedValue(undefined);
    await renderModal({ ...defaultProps, onMarkSent });

    const markBtn = [...host.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Отметить отправленным'),
    )!;
    expect(markBtn).toBeDefined();

    await act(async () => {
      markBtn.click();
    });

    expect(onMarkSent).toHaveBeenCalledWith('app-1');
  });

  it('does not render when isOpen is false', async () => {
    await renderModal({ ...defaultProps, isOpen: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
