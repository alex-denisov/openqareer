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
vi.mock('../../../vacancies/recruiterContactsApi', () => ({ getRecruiterContacts: () => Promise.resolve({ contacts: [] }) }));
vi.mock('../../../vacancies/vacancyLetterApi', () => ({ getVacancyConnectionCircles: () => Promise.resolve(undefined) }));
vi.mock('../vacancyLinks', () => ({ useVacancyLinks: () => ({}) }));
vi.mock('../b640Api', () => ({ getVacancyCard: vi.fn() }));

const HH_ID = 'cluster-src-hh-search:139180469';
const item = (id: string) => ({ cluster: { id, canonicalTitle: 'Директор по данным' }, explanation: { clusterId: id } }) as unknown as MatchedVacancyItem;
const pool = (patch: Partial<MatchedPool>): MatchedPool => ({ matched: [], total: 0, poolTotal: 0, loading: false, failed: false, complete: true, ...patch });
const readCard = vi.mocked(getVacancyCard);

let seen: CardData | undefined;
function Probe({ id }: { readonly id: string }) {
  seen = useCardData(id);
  return null;
}
let mounted: Mounted | undefined;
async function render(id: string) {
  mounted = mount(<Probe id={id} />);
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { seen = undefined; readCard.mockReset(); });
afterEach(() => { mounted?.unmount(); mounted = undefined; });

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
    readCard.mockRejectedValueOnce(new CoachApiError('Вакансия не найдена.', 'vacancy_not_found', false));
    await render(HH_ID);
    expect(seen?.load).toBe('loading');
  });
  it('сервер не знает вакансию — «не найдена»; сбой сети — «не удалось загрузить»', async () => {
    vi.mocked(useMatchedPool).mockReturnValue(pool({}));
    readCard.mockRejectedValueOnce(new CoachApiError('Вакансия не найдена.', 'vacancy_not_found', false));
    await render(HH_ID);
    expect(seen?.load).toBe('missing');
    mounted?.unmount();
    readCard.mockRejectedValueOnce(new CoachApiError('Нет сети', 'network_error', true));
    await render('cluster-src-hh-search:2');
    expect(seen?.load).toBe('failed');
  });
});
