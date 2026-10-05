// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { CareerTooltip } from './CareerTooltip';

// @ts-expect-error react act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('CareerTooltip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('наведение на элемент показывает подсказку через 300 мс', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button">Кнопка</button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tooltip.getAttribute('data-open')).toBeNull();
    expect(tooltip.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');
    expect(tooltip.getAttribute('aria-hidden')).toBe('false');
    expect(tooltip.textContent).toContain('Текст подсказки');
  });

  it('уход курсора до 300 мс отменяет показ подсказки, уход после скрывает её', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button">Кнопка</button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;

    // Уход до истечения 300 мс
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(150);
      button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      vi.advanceTimersByTime(200);
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();

    // Показ и последующий уход
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');

    act(() => {
      button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
  });

  it('фокус с клавиатуры показывает подсказку сразу, потеря фокуса скрывает', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button">Кнопка</button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tooltip.getAttribute('data-open')).toBeNull();

    act(() => {
      button.focus();
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');

    act(() => {
      button.blur();
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
  });

  it('нажатие Escape скрывает подсказку', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button">Кнопка</button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;

    act(() => {
      button.focus();
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
  });

  it('связывает подсказку через aria-describedby и убирает нативный title у элемента', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button" title="Старый нативный title" aria-label="Метка кнопки">
            Кнопка
          </button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(button.getAttribute('title')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('клик или тап по значку открывает подсказку, выставляет aria-expanded="true" и оставляет её открытой при уходе курсора', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button" aria-label="Справка">
            ⓘ
          </button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(tooltip.getAttribute('data-open')).toBeNull();

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(tooltip.getAttribute('data-open')).toBe('true');
    expect(tooltip.getAttribute('aria-hidden')).toBe('false');

    // Уход мыши не должен закрывать подсказку, открытую кликом
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(tooltip.getAttribute('data-open')).toBe('true');
  });

  it('повторный клик по значку закрывает подсказку', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button" aria-label="Справка">
            ⓘ
          </button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;

    // Первый клик — открывает
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    // Второй клик — закрывает
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('клик или тап вне открытой подсказки закрывает её', () => {
    act(() => {
      root.render(
        <div>
          <CareerTooltip content="Текст подсказки">
            <button type="button" aria-label="Справка">
              ⓘ
            </button>
          </CareerTooltip>
          <div id="outside-area">Внешняя область</div>
        </div>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;
    const outside = container.querySelector('#outside-area') as HTMLElement;

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');

    act(() => {
      outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('нажатие Escape закрывает подсказку, открытую кликом', () => {
    act(() => {
      root.render(
        <CareerTooltip content="Текст подсказки">
          <button type="button" aria-label="Справка">
            ⓘ
          </button>
        </CareerTooltip>,
      );
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement;

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(tooltip.getAttribute('data-open')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});


