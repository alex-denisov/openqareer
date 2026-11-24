// @vitest-environment jsdom
import { act, Suspense, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { retryableChunk, retryChunk, type RetryableChunk } from './chunk';
import { ChunkBoundary, ChunkView } from './ChunkBoundary';

const NETWORK = new TypeError('Failed to fetch dynamically imported module');
const loaded = { default: () => <p>Раздел открыт</p> };
let view: Mounted | null = null;
const flush = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
const text = () => view?.container.textContent ?? '';

function Host({ chunk }: { readonly chunk: RetryableChunk<object> }) {
  const [path, setPath] = useState('/app/profile');
  return (
    <>
      <nav>
        <button onClick={() => setPath('/app/career')}>Карьера</button>
      </nav>
      <ChunkBoundary chunk={chunk} resetKey={path} frame={(failure) => <div className="page">{failure}</div>}>
        <Suspense fallback={null}>
          <ChunkView key={path} chunk={chunk} props={{}} />
        </Suspense>
      </ChunkBoundary>
    </>
  );
}

const button = (label: string) =>
  [...view!.container.querySelectorAll('button')].find((item) => item.textContent === label) ?? null;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('сбой загрузки куска раздела', () => {
  it('навигация остаётся, повторов без нажатия нет', async () => {
    const request = vi.fn().mockRejectedValue(NETWORK);
    view = mount(<Host chunk={retryableChunk(request)} />);
    await flush();
    await flush();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Что-то пошло не так');
    expect(button('Карьера')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('«Попробовать снова» импортирует кусок заново', async () => {
    const request = vi.fn().mockRejectedValueOnce(NETWORK).mockResolvedValue(loaded);
    view = mount(<Host chunk={retryableChunk(request)} />);
    await flush();
    click(button('Попробовать снова'));
    await flush();
    await flush();
    expect(text()).toContain('Раздел открыт');
    expect(text()).not.toContain('Что-то пошло не так');
  });

  it('связи всё ещё нет: ошибка на месте, кнопка снова доступна', async () => {
    view = mount(<Host chunk={retryableChunk(vi.fn().mockRejectedValue(NETWORK))} />);
    await flush();
    click(button('Попробовать снова'));
    await flush();
    await flush();
    expect(button('Попробовать снова')?.disabled).toBe(false);
  });

  it('переход на другой адрес снимает ошибку и запрашивает кусок снова', async () => {
    const request = vi.fn().mockRejectedValueOnce(NETWORK).mockResolvedValue(loaded);
    view = mount(<Host chunk={retryableChunk(request)} />);
    await flush();
    click(button('Карьера'));
    await flush();
    expect(text()).toContain('Раздел открыт');
  });
});

describe('retryChunk', () => {
  const failing = { load: () => Promise.reject(NETWORK) };

  it('сервер отвечает, а кусок не грузится (новая сборка) — одна перезагрузка', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const reload = vi.fn();
    await expect(retryChunk(failing, reload)).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('сервер недоступен — без перезагрузки', async () => {
    const reload = vi.fn();
    await expect(retryChunk(failing, reload)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('не пришли стили — раздел без оформления не открывается', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unable to preload CSS for /assets/a.css'))
      .mockResolvedValue(loaded);
    const chunk = retryableChunk(request);
    await expect(chunk.load()).rejects.toThrow();
    await expect(chunk.load()).rejects.toThrow('Unable to preload CSS');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
