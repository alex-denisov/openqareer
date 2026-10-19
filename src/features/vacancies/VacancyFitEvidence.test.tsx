// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { VacancyFitSummary } from './VacancyFitSummary';
import { VacancyFitEvidence } from './VacancyFitEvidence';
import { readyVacancyFit } from '../../../e2e/fixtures/vacancyFit';
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function mount(
  initialView?: ReturnType<typeof readyVacancyFit>,
  onAddToProfile?: (requirement: string) => void,
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <>
        <VacancyFitSummary vacancyId="fit-1" />
        <VacancyFitEvidence
          vacancyId="fit-1"
          initialView={initialView}
          onAddToProfile={onAddToProfile}
        />
      </>,
    ),
  );
  return container;
}
it('POST enqueues, GET reads processing, refresh GET reveals real evidence', async () => {
  let queued = false;
  let ready = false;
  const methods: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      methods.push(method);
      if (method === 'POST') {
        queued = true;
        return Response.json({ data: { state: 'processing' } }, { status: 202 });
      }
      return Response.json({
        data: ready ? readyVacancyFit('fit-1') : { state: 'processing', requirements: [] },
      });
    }),
  );
  const container = await mount();
  await act(async () => container.querySelector('button')!.click());
  expect(queued).toBe(true);
  expect(container.textContent).toContain('Расчёт в очереди');
  expect(container.textContent).not.toContain('50%');
  ready = true;
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Обновить результат')!
      .click(),
  );
  expect(methods).toEqual(['POST', 'GET', 'GET']);
  expect(container.querySelectorAll('.vacancy-fit-percent')).toHaveLength(2);
  expect(container.querySelector('table')?.textContent).toContain(
    'Требуется опыт управления продуктом.',
  );
  expect(container.textContent).toContain('Управляла продуктом в тестовой компании.');
  expect(container.textContent).not.toContain('fixture-fact-01');
});
it('failed POST shows error without queued success or invented result', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: { message: 'Provider unavailable' } }, { status: 503 }),
    ),
  );
  const container = await mount();
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось');
  expect(container.textContent).not.toContain('Расчёт в очереди');
  expect(container.textContent).not.toContain('50%');
});

it('unconfirmed requirement retains the existing add-to-profile action', async () => {
  const add = vi.fn();
  const container = await mount(readyVacancyFit(), add);
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === 'Добавить в профиль',
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(add).toHaveBeenCalledWith('Знание немецкого языка');
});
it('late read after leaving the vacancy cannot update a newly mounted session summary', async () => {
  let resolveRead!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ data: { state: 'processing' } }, { status: 202 })
        : new Promise<Response>((resolve) => {
            resolveRead = resolve;
          }),
    ),
  );
  const container = await mount();
  await act(async () => container.querySelector('button')!.click());
  await act(async () => root!.unmount());
  root = createRoot(container);
  await act(async () => root!.render(<VacancyFitSummary vacancyId="fit-1" />));
  await act(async () => resolveRead(Response.json({ data: readyVacancyFit('fit-1') })));
  expect(container.textContent).not.toContain('50%');
  expect(container.textContent).toContain('ещё не рассчитано');
});
