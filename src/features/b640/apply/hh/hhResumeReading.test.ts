import { afterEach, describe, expect, it, vi } from 'vitest';
import { HH_REVIEW_TEXT_MAX_LENGTH } from '../../../../../shared/hhCandidateSession';

const desktop = vi.hoisted(() => ({ readHhResumeContent: vi.fn() }));
vi.mock('./hhDesktop', () => desktop);

const { forReview, forgetReadResumes, readResumesForReview } = await import('./hhResumeReading');

const NO_PAUSE = { minMs: 0, maxMs: 0 };
const items = Array.from({ length: 7 }, (_, index) => ({
  id: `r${index}`,
  title: `Резюме ${index}`,
  url: `https://hh.ru/resume/r${index}`,
  updatedLabel: 'обновлено 3 ноября',
}));
const content = (item: { id: string; title: string }) => ({ id: item.id, title: item.title, text: 'Опыт' });

afterEach(() => {
  vi.clearAllMocks();
  forgetReadResumes();
});

describe('B678: чтение резюме hh.ru для сверки', () => {
  it('не больше пяти страниц за открытие листа', async () => {
    desktop.readHhResumeContent.mockImplementation(async (item) => content(item));
    const read = await readResumesForReview(items, NO_PAUSE);
    expect(read.map((item) => item.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(5);
  });

  it('первая неудача останавливает чтение: hh.ru дальше не трогаем', async () => {
    desktop.readHhResumeContent
      .mockImplementationOnce(async (item) => content(item))
      .mockRejectedValueOnce(new Error('captcha'));
    const read = await readResumesForReview(items, NO_PAUSE);
    expect(read.map((item) => item.id)).toEqual(['r0']);
    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(2);
  });

  it('прочитанное за последний час не перечитывается, обновлённое на hh.ru — перечитывается', async () => {
    desktop.readHhResumeContent.mockImplementation(async (item) => content(item));
    await readResumesForReview(items.slice(0, 2), NO_PAUSE);
    await readResumesForReview(items.slice(0, 2), NO_PAUSE);
    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(2);
    await readResumesForReview([{ ...items[0]!, updatedLabel: 'обновлено сегодня' }], NO_PAUSE);
    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(3);
  });

  it('между страницами пауза 2–4 с', async () => {
    vi.useFakeTimers();
    try {
      desktop.readHhResumeContent.mockImplementation(async (item) => content(item));
      const pending = readResumesForReview(items.slice(0, 2));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_001);
      await pending;
      expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('для сверки уходит начало резюме', () => {
    const long = { id: 'r0', title: 'COO', text: 'я'.repeat(HH_REVIEW_TEXT_MAX_LENGTH + 10) };
    expect(forReview(long).text).toHaveLength(HH_REVIEW_TEXT_MAX_LENGTH);
  });
});
