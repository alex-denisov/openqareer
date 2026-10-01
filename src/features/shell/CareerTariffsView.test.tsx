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

  it('uses the same page header as the career sections', () => {
    expect(html).toContain('career-page-header');
    expect(html).not.toContain('career-view-heading');
  });

  it('не использует внутренний жаргон вроде «адаптеров» и «test-account»', () => {
    expect(html).not.toContain('адаптер');
    expect(html).not.toContain('test-account');
    expect(html).not.toContain('receipts');
  });

  it('B336: у плана Автоматизация подпись «Пока недоступна» без повтора', () => {
    expect(html).toContain('Пока недоступна');
    expect(html).not.toContain('пока недоступно');
    expect(html).not.toContain('Автоматизация пока недоступна · пока недоступно');
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

  it('sends the request to the server and confirms only after it is stored with formatted date', async () => {
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
    expect(container.textContent).toContain('Заявка отправлена 25 сентября — свяжемся в течение рабочего дня');
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Оставить заявку',
      ),
    ).toBe(false);
    vi.restoreAllMocks();
  });

  it('B336: если у сохранённой заявки нет даты, пишет «Заявка уже отправлена»', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(new Response('{}'));
    vi.spyOn(apiClient, 'readData').mockResolvedValueOnce([
      { planId: 'consultant' },
    ] as never);
    mount();
    // Wait for initial load
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Заявка уже отправлена');
    vi.restoreAllMocks();
  });

  it('B336: для плана Автоматизация показывает нейтральные точки вместо галочек', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(<CareerTariffsView onOpenCoach={() => undefined} />);
    });
    const picker = container.querySelector('.career-plan-picker') as HTMLElement;
    const autoButton = [...picker.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Автоматизация'),
    ) as HTMLButtonElement;
    act(() => {
      autoButton.click();
    });
    const pointsList = container.querySelector('.career-plan-detail ul') as HTMLElement;
    expect(pointsList.querySelectorAll('.career-plan-point-dot').length).toBeGreaterThan(0);
    expect(pointsList.querySelectorAll('svg:not(.career-plan-point-dot)').length).toBe(0);
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
