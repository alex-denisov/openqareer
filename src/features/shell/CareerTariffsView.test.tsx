// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../coach/apiClient';
import { CareerTariffsView } from './CareerTariffsView';
import { CURRENT_PLAN, tariffPackages } from './tariffPackages';

/**
 * Экран открывался на «Настройке поиска» — платном тарифе, который никто не
 * подключал и подключить нельзя: оплаты в продукте нет. Кандидат видел чужой
 * план выбранным и ни слова о том, на чём он на самом деле.
 */
describe('CareerTariffsView', () => {
  const html = renderToStaticMarkup(<CareerTariffsView onOpenCoach={() => undefined} />);

  it('открывается на плане, который у кандидата действительно есть', () => {
    expect(html).toContain(CURRENT_PLAN.name);
    expect(html).toContain('Ваш план сейчас');
  });

  it('не выдаёт платный тариф за выбранный', () => {
    const paid = tariffPackages.find((plan) => plan.id === 'setup')!;
    const selected = html.match(/is-selected[^]*?<\/button>/u)?.[0] ?? '';

    expect(selected).toContain(CURRENT_PLAN.name);
    expect(selected).not.toContain(paid.name);
  });

  it('говорит прямо, что оплата не подключена', () => {
    expect(html).toContain('Оплата не подключена');
  });

  it('не использует внутренний жаргон вроде «адаптеров» и «test-account»', () => {
    expect(html).not.toContain('адаптер');
    expect(html).not.toContain('test-account');
    expect(html).not.toContain('receipts');
  });
});

describe('CareerTariffsView · заявка на план с консультантом', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mount() {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<CareerTariffsView onOpenCoach={() => undefined} />);
    });
    const picker = container.querySelector('.career-plan-picker') as HTMLElement;
    const setupButton = [...picker.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('С консультантом'),
    ) as HTMLButtonElement;
    act(() => {
      setupButton.click();
    });
  }

  it('sends the request to the server and confirms only after it is stored', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData')
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({
        planId: 'consultant',
        createdAt: '2026-09-25T06:00:00.000Z',
      } as never);
    mount();
    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Оставить заявку',
    ) as HTMLButtonElement;
    expect(submit).toBeTruthy();

    await act(async () => {
      submit.click();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/candidate/plan-requests',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(container.textContent).toContain('Заявка отправлена — свяжемся в течение рабочего дня');
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Оставить заявку',
      ),
    ).toBe(false);
    vi.restoreAllMocks();
  });

  it('says the request did not go through when the server fails', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData')
      .mockResolvedValueOnce([] as never)
      .mockRejectedValueOnce(new Error('offline'));
    mount();
    const submit = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Оставить заявку',
    ) as HTMLButtonElement;
    await act(async () => {
      submit.click();
    });
    expect(container.textContent).toContain('Заявка не ушла');
    expect(container.textContent).not.toContain('Заявка отправлена');
    vi.restoreAllMocks();
  });
});
