// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../kit/testDom';
import { SavedScreen } from './SavedScreen';

const pool = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../../vacancies/useMatchedPool', () => ({ useMatchedPool: () => pool.value }));
const saved = vi.hoisted(() => ({ value: new Map<string, object>() }));
vi.mock('../vacancyLinks', () => ({
  isSaved: (application: unknown) => Boolean(application),
  useVacancyLinks: () => ({ byCluster: saved.value, loading: false, failed: false }),
}));
vi.mock('./TableBlock', () => ({ TableBlock: () => null }));
vi.mock('./sortModel', async (original) => ({
  ...(await original<object>()),
  sortItems: (items: unknown) => items,
}));
vi.mock('../../../vacancies/useCurrencyRates', () => ({ useCurrencyRates: () => null }));
vi.mock('./useRowInteractions', () => ({ useRowInteractions: () => ({ hiddenIds: new Set() }) }));
vi.mock('../../kit', async (original) => ({
  ...(await original<object>()),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  saved.value = new Map();
});

function text(reading: boolean): string {
  const row = { cluster: { id: 'c' } };
  pool.value = { matched: [row], loading: false, reading, failed: false, complete: !reading };
  view = mount(<SavedScreen />);
  return view.container.textContent ?? '';
}

describe('v06s «Сохранённые» (Д3)', () => {
  it('подборка дочитывается — ожидание, а не пусто', () => {
    expect(text(true)).not.toContain('Сохранённых вакансий нет');
  });
  it('дочитана — пусто', () => {
    expect(text(false)).toContain('Сохранённых вакансий нет');
  });
  it('найдены не все сохранённые — число не называется; все — называется', () => {
    saved.value = new Map([['c', {}], ['d', {}]]);
    expect(text(true)).not.toContain('сохранённая вакансия');
    view?.unmount();
    expect(text(false)).toContain('1 сохранённая вакансия');
    view?.unmount();
    saved.value = new Map([['c', {}]]);
    expect(text(true)).toContain('1 сохранённая вакансия');
  });
});
