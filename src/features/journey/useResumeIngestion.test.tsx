// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPdfResume } from '../workspace/pdfResume';
import { useResumeIngestion, type ResumeIngestionState } from './useResumeIngestion';

vi.mock('../workspace/pdfResume', () => ({
  extractPdfResume: vi.fn(),
}));

describe('useResumeIngestion', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    vi.clearAllMocks();
  });

  it('returns the parsed PDF result for FirstRun to persist', async () => {
    vi.mocked(extractPdfResume).mockResolvedValue({
      text: 'Резюме: управлял командой продукта и отвечал за запуск новой линейки.',
      fileName: 'resume.pdf',
      pageCount: 1,
      inspection: {
        parser: 'pdf-inspector-wasm',
        parserVersion: 'test',
        documentKind: 'native_text',
        route: 'direct_text',
        confidence: 1,
        pagesNeedingOcr: [],
        pagesWithColumns: [],
        pagesWithTables: [],
        hasEncodingIssues: false,
        instructionSignals: [],
        requiresRenderedReview: false,
      },
    });
    let ingestion: ResumeIngestionState | undefined;
    const host = document.createElement('div');
    root = createRoot(host);
    function HookProbe() {
      ingestion = useResumeIngestion(false);
      return null;
    }

    await act(async () => root?.render(<HookProbe />));
    let result: Awaited<ReturnType<ResumeIngestionState['readPdf']>> = undefined;
    await act(async () => {
      result = await ingestion!.readPdf(new File(['pdf'], 'resume.pdf', { type: 'application/pdf' }));
    });

    expect(result).toMatchObject({
      source: 'pdf',
      imported: false,
      text: 'Резюме: управлял командой продукта и отвечал за запуск новой линейки.',
      file: { name: 'resume.pdf', pages: 1 },
    });
    expect(ingestion?.result).toEqual(result);
    expect(extractPdfResume).toHaveBeenCalledOnce();
  });

  it('returns an honest missing result and stores the read error', async () => {
    vi.mocked(extractPdfResume).mockRejectedValueOnce(new Error('invalid_pdf'));
    let ingestion: ResumeIngestionState | undefined;
    const host = document.createElement('div');
    root = createRoot(host);
    function HookProbe() {
      ingestion = useResumeIngestion(false);
      return null;
    }

    await act(async () => root?.render(<HookProbe />));
    let result: Awaited<ReturnType<ResumeIngestionState['readPdf']>> = undefined;
    await act(async () => {
      result = await ingestion!.readPdf(new File(['not a pdf'], 'resume.pdf', { type: 'application/pdf' }));
    });

    expect(result).toBeUndefined();
    expect(ingestion?.error).toBe('invalid_pdf');
  });
});
