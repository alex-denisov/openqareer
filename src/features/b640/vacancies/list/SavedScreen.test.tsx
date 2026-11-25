// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../kit/testDom';
import { SavedScreen } from './SavedScreen';

const pool = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../../vacancies/useMatchedPool', () => ({ useMatchedPool: () => pool.value }));
vi.mock('../vacancyLinks', () => ({
  isSaved: () => false,
  useVacancyLinks: () => ({ byCluster: new Map(), loading: false, failed: false }),
}));
vi.mock('../../../vacancies/useCurrencyRates', () => ({ useCurrencyRates: () => null }));
vi.mock('./useRowInteractions', () => ({ useRowInteractions: () => ({ hiddenIds: new Set() }) }));
vi.mock('../../kit', async (original) => ({
  ...(await original<object>()),
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

let view: Mounted | null = null;
afterEach(() => view?.unmount());

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
});
