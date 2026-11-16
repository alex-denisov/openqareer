// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { useLoad } from './useLoad';

let view: Mounted | null = null;
afterEach(() => view?.unmount());

function Probe({ loader }: { readonly loader: (signal: AbortSignal) => Promise<string> }) {
  const load = useLoad(loader);
  return (
    <button type="button" onClick={load.retry}>
      {load.state === 'ready' ? load.data : load.state}
    </button>
  );
}

const text = (v: Mounted) => v.container.querySelector('button')?.textContent;

describe('useLoad', () => {
  it('ожидание, затем данные', async () => {
    const loader = vi.fn(() => Promise.resolve('готово'));
    view = mount(<Probe loader={loader} />);
    expect(text(view)).toBe('loading');
    await act(async () => undefined);
    expect(text(view)).toBe('готово');
  });

  it('ошибка, повтор читает заново', async () => {
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('сбой'))
      .mockResolvedValueOnce('со второго раза');
    view = mount(<Probe loader={loader} />);
    await act(async () => undefined);
    expect(text(view)).toBe('error');
    click(view.container.querySelector('button'));
    await act(async () => undefined);
    expect(text(view)).toBe('со второго раза');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('повтор после успеха не прячет данные; при сбое остаются прежние', async () => {
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('первое')
      .mockRejectedValueOnce(new Error('сбой'))
      .mockResolvedValueOnce('второе');
    view = mount(<Probe loader={loader} />);
    await act(async () => undefined);
    click(view.container.querySelector('button'));
    expect(text(view)).toBe('первое');
    await act(async () => undefined);
    expect(text(view)).toBe('первое');
    click(view.container.querySelector('button'));
    await act(async () => undefined);
    expect(text(view)).toBe('второе');
  });

  it('после ухода с экрана ответ не применяется, чтение прервано', async () => {
    let signal: AbortSignal | null = null;
    const loader = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<string>(() => undefined);
    });
    view = mount(<Probe loader={loader} />);
    view.unmount();
    view = null;
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });
});
