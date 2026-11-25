// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../coach/apiClient';

const api = vi.hoisted(() => ({ circles: vi.fn(), pitch: vi.fn() }));
vi.mock('./vacancyLetterApi', async (original) => ({
  ...(await original<object>()),
  getVacancyConnectionCircles: api.circles,
}));
vi.mock('./vacancyPitchApi', async (original) => ({
  ...(await original<object>()),
  requestVacancyPitch: api.pitch,
}));
const { useVacancyLetterController } = await import('./vacancyLetterController');

const ID = 'cluster-ats-greenhouse-intersystems:7606888003';
const PITCH = {
  vacancyId: ID,
  emailPitch: { subject: 'Отклик', body: 'Письмо.' },
  linkedInNote: '',
  atsCoverLetter: 'Письмо.',
  usedEvidenceIds: [],
  generatedAt: '2026-11-25T08:00:00.000Z',
};
const OUTSIDE = new CoachApiError(
  'Вакансия не найдена в текущей подборке.',
  'vacancy_not_in_candidate_selection',
  false,
);

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.resetAllMocks();
});

async function mount(circle: 1 | 3, holdDraft = false) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let state!: ReturnType<typeof useVacancyLetterController>;
  function Harness() {
    state = useVacancyLetterController(ID, circle, { holdDraft });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness />));
  return () => state;
}

describe('письмо не зависит от знакомых', () => {
  it('вакансия не из подборки: знакомых нет, письмо собрано одним запросом', async () => {
    api.circles.mockRejectedValue(OUTSIDE);
    api.pitch.mockResolvedValue(PITCH);
    const get = await mount(3);
    expect(api.pitch).toHaveBeenCalledTimes(1);
    expect(api.pitch).toHaveBeenCalledWith(ID, { tone: 'executive' });
    expect(get().circles).toMatchObject({ data: null, loading: false, error: '' });
    expect(get().draft.text).not.toBe('');
  });

  it('знакомые не загрузились: письмо работодателю всё равно собрано', async () => {
    api.circles.mockRejectedValue(new Error('Сеть недоступна'));
    api.pitch.mockResolvedValue(PITCH);
    const get = await mount(3);
    expect(api.pitch).toHaveBeenCalledTimes(1);
    expect(get().circles.error).toBe('Сеть недоступна');
  });

  it('знакомому без пути и придержанный черновик не просят', async () => {
    api.circles.mockRejectedValue(OUTSIDE);
    await mount(1);
    await mount(3, true);
    expect(api.pitch).not.toHaveBeenCalled();
  });
});
