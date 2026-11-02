// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import type { UseApplications } from './useApplications';
import { ResponsesOffersPanel } from './ResponsesOffersPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listPage = vi.hoisted(() => vi.fn());
vi.mock('./applicationsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applicationsApi')>()),
  listApplicationsPage: listPage,
}));

function offer(id: string, company: string): ApplicationView {
  return {
    id,
    stage: 'offer',
    version: 1,
    vacancy: { title: 'Head of Platform', company, source: 'hh' },
    offer: { applicationId: id, terms: { baseSalary: 300000, currency: 'RUB' }, respondBy: null },
  } as unknown as ApplicationView;
}

let host: HTMLDivElement;
let root: Root;
const state = { addManualCard: vi.fn(), saveOffer: vi.fn() } as unknown as UseApplications;

async function render() {
  await act(async () => {
    root.render(<ResponsesOffersPanel state={state} />);
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  listPage.mockReset();
});

describe('ResponsesOffersPanel', () => {
  it('shows the empty state, the primary action and the total comp chips', async () => {
    listPage.mockResolvedValue({ items: [] });
    await render();
    expect(host.textContent).toContain(
      'Офферов пока нет. Когда придёт первый, добавьте его: платформа соберёт total comp и покажет позицию на торге.',
    );
    const add = Array.from(host.querySelectorAll('button')).filter((node) =>
      /Добавить оффер/.test(node.textContent ?? ''),
    );
    expect(add.length).toBeGreaterThan(0);
    const chips = Array.from(host.querySelectorAll('.career-offers-chips span')).map(
      (node) => node.textContent,
    );
    expect(chips).toEqual(['Оклад', 'Бонус', 'Акции и опционы', 'ДМС', 'Релокация']);
    expect(host.textContent).toContain('Сравнение двух офферов появится после добавления второго.');
    expect(host.textContent).not.toContain('Обновить офферы');
  });

  it('lists one offer without a compare button and keeps the note', async () => {
    listPage.mockResolvedValue({ items: [offer('o1', 'Арка Холдинг')] });
    await render();
    expect(host.textContent).toContain('Арка Холдинг');
    expect(host.textContent).toContain('Изменить условия');
    expect(host.textContent).not.toContain('Сравнить офферы');
    expect(host.textContent).toContain('появится после добавления второго');
  });

  it('moves compare into the offers card and drops the note with two offers', async () => {
    listPage.mockResolvedValue({ items: [offer('o1', 'А'), offer('o2', 'Б')] });
    await render();
    expect(host.textContent).toContain('Сравнить офферы');
    expect(host.textContent).not.toContain('появится после добавления второго');
  });

  it('reports a load error with a retry', async () => {
    listPage.mockRejectedValue(new Error('boom'));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось загрузить офферы',
    );
  });
});
