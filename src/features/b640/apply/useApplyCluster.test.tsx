// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import { applyRoute } from './model/applyModel';
import { useApplyCluster } from './useApplyCluster';

const api = vi.hoisted(() => ({
  getVacancyCard: vi.fn(),
  postApplyTarget: vi.fn(),
  readCachedMatchedPool: vi.fn(),
}));
vi.mock('../vacancies/b640Api', () => ({
  getVacancyCard: api.getVacancyCard,
  postApplyTarget: api.postApplyTarget,
}));
vi.mock('../../vacancies/matchedPoolCache', () => ({
  readCachedMatchedPool: api.readCachedMatchedPool,
}));

const GETMATCH = { sourceName: 'Getmatch', sourceUrl: 'https://getmatch.ru/vacancies/37138' };
const HH = { sourceName: 'hh.ru (страница поиска)', sourceUrl: 'https://hh.ru/vacancy/139105692' };
const item = (sources: readonly object[]) => ({
  cluster: { id: 'cluster-1', primaryUrl: GETMATCH.sourceUrl, sources },
});

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.resetAllMocks();
});

/** Что видел экран по порядку: состояние или адрес площадки. */
async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const seen: Array<string | null> = [];
  let retry: () => void = () => undefined;
  function Harness() {
    const result = useApplyCluster('cluster-1');
    retry = result.retry;
    const shown =
      result.state.status === 'ready'
        ? applyRoute({ application: null, cluster: result.state.cluster }).url
        : result.state.status;
    if (seen.length === 0 || seen.at(-1) !== shown) seen.push(shown);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness />));
  return { seen, retry: () => act(async () => retry()) };
}

describe('useApplyCluster: порядок состояний площадки (B678)', () => {
  it('ожидание, затем сразу hh.ru: Getmatch не показан ни разу, запрос один', async () => {
    api.getVacancyCard.mockResolvedValue(item([GETMATCH, HH]));
    expect((await mount()).seen).toEqual(['loading', HH.sourceUrl]);
    expect(api.getVacancyCard).toHaveBeenCalledTimes(1);
  });

  it('B787: hh.ru в склейке подборки сверяет сервер — чужая запись не показана ни разу', async () => {
    api.readCachedMatchedPool.mockReturnValue({ matched: [item([GETMATCH, HH])] });
    api.getVacancyCard.mockResolvedValue(item([GETMATCH]));
    expect((await mount()).seen).toEqual(['loading', GETMATCH.sourceUrl]);
  });

  it('hh.ru — единственный источник показанной строки: без ожидания и без запроса', async () => {
    api.readCachedMatchedPool.mockReturnValue({ matched: [item([HH])] });
    expect((await mount()).seen).toEqual([HH.sourceUrl]);
    expect(api.getVacancyCard).not.toHaveBeenCalled();
  });

  it('в подборке только Getmatch — не окончательно: ждём ответ по вакансии', async () => {
    api.readCachedMatchedPool.mockReturnValue({ matched: [item([GETMATCH])] });
    api.getVacancyCard.mockResolvedValue(item([GETMATCH, HH]));
    expect((await mount()).seen).toEqual(['loading', HH.sourceUrl]);
  });

  it('вакансия снята — площадки подбора нет', async () => {
    api.getVacancyCard.mockRejectedValue(new CoachApiError('Снята', 'vacancy_gone', false));
    expect((await mount()).seen).toEqual(['loading', null]);
  });

  it('сбой чтения — площадка не называется, повтор дочитывает', async () => {
    api.getVacancyCard.mockRejectedValueOnce(new Error('сеть'));
    api.getVacancyCard.mockResolvedValue(item([HH]));
    const screen = await mount();
    await screen.retry();
    expect(screen.seen).toEqual(['loading', 'failed', 'loading', HH.sourceUrl]);
  });

  it('B787: трекер раскрыт до показа экрана; не раскрылся — прежняя площадка', async () => {
    const tracker = {
      channel: 'site',
      url: 'https://grnh.se/a',
      formUrl: 'https://grnh.se/a',
      origin: 'url',
      needsRedirect: true,
    };
    const final = {
      channel: 'greenhouse',
      url: 'https://boards.greenhouse.io/a/jobs/1',
      formUrl: 'x',
      origin: 'redirect',
    };
    api.getVacancyCard.mockResolvedValue({ ...item([GETMATCH]), applyTarget: tracker });
    api.postApplyTarget.mockResolvedValueOnce(final).mockRejectedValueOnce(new Error('сеть'));
    expect((await mount()).seen).toEqual(['loading', final.url]);
    expect((await mount()).seen).toEqual(['loading', GETMATCH.sourceUrl]);
  });
});
