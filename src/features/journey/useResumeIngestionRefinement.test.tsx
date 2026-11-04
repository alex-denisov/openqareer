// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResumeRefinement, importCandidateResume } from '../resume/resumeApi';
import { parseResumeContent } from '../workspace/resumeParser';
import { useResumeIngestion, type ResumeIngestionState } from './useResumeIngestion';

vi.mock('../workspace/pdfResume', () => ({ extractPdfResume: vi.fn() }));
vi.mock('../resume/resumeApi', () => ({
  importCandidateResume: vi.fn(),
  getResumeRefinement: vi.fn(),
}));

const TEXT = 'Опыт работы\nООО «Тест» — Инженер\nМарт 2021 — настоящее время\nНавыки\nTypeScript';

describe('useResumeIngestion refinement (04.11)', () => {
  let root: Root | undefined;
  let ingestion: ResumeIngestionState | undefined;

  function Harness() {
    ingestion = useResumeIngestion(true);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    root = createRoot(document.createElement('div'));
    act(() => root?.render(<Harness />));
    vi.mocked(importCandidateResume).mockResolvedValue({
      parsed: parseResumeContent(TEXT),
      resume: {},
      structuredBy: 'rules',
      refinement: 'pending',
      factCount: 2,
    } as never);
  });

  afterEach(() => {
    act(() => root?.unmount());
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const accept = () =>
    act(async () => {
      await ingestion?.acceptParsed(parseResumeContent(TEXT), 'text');
    });
  const tick = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

  it('shows the rules reading at once and takes the model reading when it lands', async () => {
    const refined = { ...parseResumeContent(TEXT), targetRole: 'Прочитала модель' };
    vi.mocked(getResumeRefinement)
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'refined', parsed: refined, factCount: 9 });
    await accept();
    expect(ingestion?.result?.factCount).toBe(2);
    await tick();
    expect(ingestion?.result?.factCount).toBe(2);
    await tick();
    expect(ingestion?.result).toMatchObject({ factCount: 9, parsed: { targetRole: 'Прочитала модель' } });
    await tick();
    expect(getResumeRefinement).toHaveBeenCalledTimes(2);
  });

  it('stops asking when the model kept the rules reading', async () => {
    vi.mocked(getResumeRefinement).mockResolvedValue({ status: 'kept' });
    await accept();
    await tick();
    await tick();
    expect(getResumeRefinement).toHaveBeenCalledTimes(1);
    expect(ingestion?.result?.factCount).toBe(2);
  });
});
