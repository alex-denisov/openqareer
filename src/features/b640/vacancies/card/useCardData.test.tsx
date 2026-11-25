// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../../coach/apiClient';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { useMatchedPool, type MatchedPool } from '../../../vacancies/useMatchedPool';
import { mount, type Mounted } from '../../kit/testDom';
import { getVacancyCard } from '../b640Api';
import { useCardData, type CardData } from './useCardData';

vi.mock('../../../vacancies/useMatchedPool', () => ({ useMatchedPool: vi.fn() }));
vi.mock('../../../vacancies/useCurrencyRates', () => ({ useCurrencyRates: () => undefined }));
vi.mock('../../../vacancies/recruiterContactsApi', () => ({
  getRecruiterContacts: () => Promise.resolve({ contacts: [] }),
}));
vi.mock('../../../vacancies/vacancyLetterApi', () => ({
  getVacancyConnectionCircles: () => Promise.resolve(undefined),
}));
vi.mock('../vacancyLinks', () => ({ useVacancyLinks: () => ({}) }));
vi.mock('../b640Api', () => ({ getVacancyCard: vi.fn() }));

const HH_ID = 'cluster-src-hh-search:139180469';
const item = (id: string) =>
  ({
    cluster: { id, canonicalTitle: 'Директор по данным' },
    explanation: { clusterId: id },
  }) as unknown as MatchedVacancyItem;
const pool = (patch: Partial<MatchedPool>): MatchedPool => ({
  matched: [],
  total: 0,
  poolTotal: 0,
  loading: false,
  failed: false,
  complete: true,
  ...patch,
});
const readCard = vi.mocked(getVacancyCard);

let seen: CardData | undefined;
function Probe({ id }: { readonly id: string }) {
  seen = useCardData(id);
  return null;
}
let mounted: Mounted | undefined;
async function render(id: string) {
  mounted = mount(<Probe id={id} />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  seen = undefined;
  readCard.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('B715: карточка v04 по id вакансии пула', () => {
  it('вакансии нет в подборке (после отклика, ссылка hh.ru) — читает её отдельно и показывает', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [item('cluster-a')] }));
    readCard.mockResolvedValue(item(HH_ID));
    await render(HH_ID);
    expect(readCard).toHaveBeenCalledWith(HH_ID, expect.any(AbortSignal));
    expect(seen?.load).toBe('ready');
    expect(seen?.item?.cluster.id).toBe(HH_ID);
  });
  it('вакансия в подборке — отдельного чтения нет', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [item(HH_ID)] }));
    await render(HH_ID);
    expect(readCard).not.toHaveBeenCalled();
    expect(seen?.load).toBe('ready');
  });
  // B654 23.11: подборка читается страницами (40+ запросов, ~9 с) — карточка не ждёт её, а читает
  // свою вакансию одним запросом по id. «Не найдена» до конца подборки остаётся «загружаем».
  it('пока подборка читается — карточка читает вакансию по id и показывается сразу', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ loading: true }));
    readCard.mockResolvedValue(item(HH_ID));
    await render(HH_ID);
    expect(readCard).toHaveBeenCalledTimes(1);
    expect(seen?.load).toBe('ready');
    expect(seen?.item?.cluster.id).toBe(HH_ID);
  });
  it('пока подборка читается, «не найдена» ещё не окончательно — «загружаем»', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ loading: true }));
    readCard.mockRejectedValueOnce(
      new CoachApiError('Вакансия не найдена.', 'vacancy_not_found', false),
    );
    await render(HH_ID);
    expect(seen?.load).toBe('loading');
  });
  it('сервер не знает вакансию — «не найдена»; сбой сети — «не удалось загрузить»', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({}));
    readCard.mockRejectedValueOnce(
      new CoachApiError('Вакансия не найдена.', 'vacancy_not_found', false),
    );
    await render(HH_ID);
    expect(seen?.load).toBe('missing');
    mounted?.unmount();
    readCard.mockRejectedValueOnce(new CoachApiError('Нет сети', 'network_error', true));
    await render('cluster-src-hh-search:2');
    expect(seen?.load).toBe('failed');
  });
  it('B797: строка hh ещё в подборке, а площадка вакансию сняла — «закрыта»', async () => {
    const row = item(HH_ID);
    const sources = [{ sourceUrl: 'https://hh.ru/vacancy/139180469' }];
    const pooled = { ...row, cluster: { ...row.cluster, sources } } as MatchedVacancyItem;
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [pooled] }));
    readCard.mockRejectedValueOnce(
      new CoachApiError('Вакансия снята с площадки.', 'vacancy_gone', false),
    );
    await render(HH_ID);
    expect(seen?.load).toBe('closed');
  });
  it('B797: вакансия снята с площадки — «закрыта»', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({}));
    readCard.mockRejectedValueOnce(
      new CoachApiError('Вакансия снята с площадки.', 'vacancy_gone', false),
    );
    await render(HH_ID);
    expect(seen?.load).toBe('closed');
  });
  it('B770: карточка читает одну страницу подборки, а не все 46', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [item(HH_ID)] }));
    await render(HH_ID);
    expect(vi.mocked(useMatchedPool).mock.lastCall?.[1]).toEqual({ pageLimit: 1 });
  });
});

describe('B787: hh.ru в склейке подборки показан только после сверки', () => {
  const GETMATCH = { sourceId: 'src-fh-getmatch', sourceUrl: 'https://getmatch.ru/vacancies/7' };
  const HH = { sourceId: 'src-hh-search', sourceUrl: 'https://hh.ru/vacancy/1' };
  const glued = (...sources: object[]) =>
    ({
      ...item('cluster-g'),
      cluster: { ...item('cluster-g').cluster, sources, primaryUrl: GETMATCH.sourceUrl },
    }) as unknown as MatchedVacancyItem;
  it.each([
    ['ответа ещё нет', undefined, [GETMATCH]],
    ['чужая запись', glued(GETMATCH), [GETMATCH]],
    ['своя запись', glued(GETMATCH, HH), [GETMATCH, HH]],
  ])('%s', async (_, answer, sources) => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [glued(GETMATCH, HH)] }));
    readCard.mockReturnValue(answer ? Promise.resolve(answer) : new Promise(() => undefined));
    await render('cluster-g');
    expect(seen?.load).toBe('ready');
    expect(seen?.item?.cluster.sources).toEqual(sources);
  });
  it('сбой сверки — «не удалось загрузить», повтор читает карточку снова', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [glued(GETMATCH, HH)] }));
    readCard.mockRejectedValueOnce(new CoachApiError('Нет сети', 'network_error', true));
    await render('cluster-g');
    expect(seen?.load).toBe('failed');
    readCard.mockResolvedValue(glued(GETMATCH, HH));
    await act(async () => {
      seen?.reload();
      await Promise.resolve();
    });
    expect(seen?.load).toBe('ready');
    expect(seen?.item?.cluster.sources).toEqual([GETMATCH, HH]);
  });
  it('в склейке только записи hh.ru — до ответа «загружаем»', async () => {
    const second = { ...HH, sourceUrl: 'https://hh.ru/vacancy/2' };
    vi.mocked(useMatchedPool).mockReturnValue(pool({ matched: [glued(HH, second)] }));
    readCard.mockReturnValue(new Promise(() => undefined));
    await render('cluster-g');
    expect(seen?.load).toBe('loading');
  });
});
