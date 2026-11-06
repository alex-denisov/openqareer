// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePitchFetcher } from './usePitchFetcher';
import type { VacancyPitchResult } from './vacancyPitchApi';

/** Экраны передают вакансию новым объектом при каждой отрисовке, а каждый запрос платный и идёт до 100 с. */
describe('usePitchFetcher', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const fetchPitch = () => vi.fn(async () => ({}) as VacancyPitchResult);

  function Probe({ id, fetcher }: { readonly id: string; readonly fetcher: ReturnType<typeof fetchPitch> }) {
    usePitchFetcher(true, { id, title: 'CTO' }, 'executive', undefined, undefined, fetcher);
    return null;
  }

  it('новый объект той же вакансии не повторяет запрос', async () => {
    const fetcher = fetchPitch();
    await act(async () => root.render(<Probe id="v1" fetcher={fetcher} />));
    await act(async () => root.render(<Probe id="v1" fetcher={fetcher} />));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('другая вакансия запрашивается заново', async () => {
    const fetcher = fetchPitch();
    await act(async () => root.render(<Probe id="v1" fetcher={fetcher} />));
    await act(async () => root.render(<Probe id="v2" fetcher={fetcher} />));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
