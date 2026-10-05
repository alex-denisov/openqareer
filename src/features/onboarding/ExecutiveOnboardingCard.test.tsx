// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecutiveOnboardingCard } from './ExecutiveOnboardingCard';

describe('ExecutiveOnboardingCard (B357)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  async function renderCard() {
    await act(async () => {
      root.render(<ExecutiveOnboardingCard />);
    });
  }

  it('рендерит заголовок, прогресс-бар и дефолтные задачи', async () => {
    await renderCard();

    expect(host.textContent).toContain('Executive-онбординг: 30-60-90 дней');
    expect(host.textContent).toContain('Совет стратега на этот этап');

    const progressBadge = host.querySelector('[data-testid="onboarding-progress-badge"]');
    expect(progressBadge?.textContent).toContain('0%');

    const taskList = host.querySelector('[data-testid="onboarding-task-list"]');
    expect(taskList).not.toBeNull();
  });

  it('переключает этапы по клику на табы', async () => {
    await renderCard();

    const prepTab = host.querySelector('[data-testid="stage-tab-prep"]') as HTMLButtonElement;
    expect(prepTab).not.toBeNull();

    await act(async () => {
      prepTab.click();
    });

    expect(prepTab.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('Задачи этапа (Подготовка)');
  });

  it('отмечает задачу выполненной и обновляет прогресс', async () => {
    await renderCard();

    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      checkbox.click();
    });

    expect(checkbox.checked).toBe(true);
    const progressBadge = host.querySelector('[data-testid="onboarding-progress-badge"]');
    expect(progressBadge?.textContent).not.toContain('0 из');
  });

  it('сворачивает и разворачивает содержимое по кнопке', async () => {
    await renderCard();

    const toggleBtn = host.querySelector('[data-testid="toggle-expand-card-btn"]') as HTMLButtonElement;
    expect(host.querySelector('[data-testid="coach-advice-box"]')).not.toBeNull();

    await act(async () => {
      toggleBtn.click();
    });

    expect(host.querySelector('[data-testid="coach-advice-box"]')).toBeNull();

    await act(async () => {
      toggleBtn.click();
    });

    expect(host.querySelector('[data-testid="coach-advice-box"]')).not.toBeNull();
  });

  it('добавляет цель OKR через форму', async () => {
    await renderCard();

    const openGoalBtn = host.querySelector('[data-testid="toggle-goal-form-btn"]') as HTMLButtonElement;
    await act(async () => {
      openGoalBtn.click();
    });

    const titleInput = host.querySelector('#goal-title') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        titleInput,
        'Ускорить релизы в 3 раза'
      );
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = host.querySelector('[data-testid="goal-form"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const goalsList = host.querySelector('[data-testid="goals-list"]');
    expect(goalsList?.textContent).toContain('Ускорить релизы в 3 раза');
  });

  it('добавляет квант STAR и маскирует конфиденциальные токены при NDA нарушении', async () => {
    await renderCard();

    const openQuantumBtn = host.querySelector('[data-testid="toggle-quantum-form-btn"]') as HTMLButtonElement;
    await act(async () => {
      openQuantumBtn.click();
    });

    const sitInput = host.querySelector('#quantum-situation') as HTMLInputElement;
    const actInput = host.querySelector('#quantum-action') as HTMLInputElement;
    const resInput = host.querySelector('#quantum-result') as HTMLInputElement;

    await act(async () => {
      const setVal = (el: HTMLInputElement, val: string) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setVal(sitInput, 'Сбой в проде с ключом sk-proj-1234567890abcdef1234567890');
      setVal(actInput, 'Локализовал проблему в шлюзе');
      setVal(resInput, 'Доступность восстановлена за 4 минуты');
    });

    const form = host.querySelector('[data-testid="quantum-form"]') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const quantumsList = host.querySelector('[data-testid="quantums-list"]');
    expect(quantumsList?.textContent).toContain('Доступность восстановлена');
    expect(quantumsList?.textContent).toContain('[СКРЫТО]');
    expect(quantumsList?.textContent).not.toContain('sk-proj-');
  });
});
