import { describe, expect, it } from 'vitest';
import {
  extractPdfResume,
  importFromInspection,
  normalizeExtractedPageText,
  PdfResumeImportError,
} from './pdfResume';
import type { PdfInspection } from './pdfInspector';

const nativeInspection: PdfInspection = {
  parser: 'pdf-inspector-wasm',
  parserVersion: '0.1.3-test',
  documentKind: 'native_text',
  pageCount: 2,
  text: 'Synthetic candidate evidence. '.repeat(4),
  confidence: 0.98,
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  pagesWithColumns: [2],
  pagesWithTables: [],
  hasEncodingIssues: false,
  instructionSignals: [],
  route: 'direct_text',
  requiresRenderedReview: true,
};

describe('normalizeExtractedPageText', () => {
  it('keeps readable order and removes repeated whitespace', () => {
    expect(
      normalizeExtractedPageText([
        { str: 'Руководитель' },
        { str: '   продукта ' },
        { str: '' },
        { str: 'Запускал  новые   направления.' },
      ]),
    ).toBe('Руководитель продукта Запускал новые направления.');
  });

  it('ignores non-text PDF items', () => {
    expect(normalizeExtractedPageText([{ type: 'marked-content' }])).toBe('');
  });

  it('preserves explicit PDF line endings for later evidence review', () => {
    expect(
      normalizeExtractedPageText([
        { str: 'Опыт', hasEOL: true },
        { str: 'Запустил продукт.', hasEOL: true },
        { str: 'Навыки' },
      ]),
    ).toBe('Опыт\nЗапустил продукт.\nНавыки');
  });
});

describe('importFromInspection', () => {
  it('accepts complete native text and preserves inspection provenance', () => {
    expect(importFromInspection('synthetic.pdf', nativeInspection)).toEqual({
      fileName: 'synthetic.pdf',
      pageCount: 2,
      text: nativeInspection.text.trim(),
      inspection: nativeInspection,
    });
  });

  it.each([
    ['ocr_required', 'scanned', [1, 2], 'ocr_required'],
    ['hybrid_text_ocr', 'mixed', [2], 'hybrid_ocr_required'],
  ] as const)(
    'rejects %s output rather than promoting a partial dossier',
    (route, documentKind, pagesNeedingOcr, expectedCode) => {
      const inspection: PdfInspection = {
        ...nativeInspection,
        documentKind,
        route,
        pagesNeedingOcr: [...pagesNeedingOcr],
      };

      expect(() => importFromInspection('synthetic.pdf', inspection)).toThrow(
        expect.objectContaining({
          name: 'PdfResumeImportError',
          code: expectedCode,
          inspection,
        }) as PdfResumeImportError,
      );
    },
  );

  it('keeps the 40-page resume boundary before accepting extracted text', () => {
    expect(() =>
      importFromInspection('synthetic.pdf', {
        ...nativeInspection,
        pageCount: 41,
      }),
    ).toThrow(expect.objectContaining({ code: 'too_many_pages' }));
  });
});

describe('extractPdfResume fallback', () => {
  it('reads a synthetic PDF through pdfjs when browser Worker is unavailable', async () => {
    const file = new File(
      ['%PDF-1.4 synthetic fixture'],
      'synthetic-resume.pdf',
      { type: 'application/pdf' },
    );

    const result = await extractPdfResume(file, {
      inspect: async () => {
        throw new Error('synthetic_wasm_unavailable');
      },
      loadPdfJs: async () => ({
        version: '6.2.108-test',
        imageOperatorCodes: [85],
        open: async () => ({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({
              items: [
                {
                  str: 'Synthetic resume evidence with enough readable content. '.repeat(3),
                  hasEOL: true,
                  transform: [1, 0, 0, 1, 72, 720],
                  width: 400,
                  height: 12,
                },
              ],
            }),
            getOperatorList: async () => ({ fnArray: [] }),
            getViewport: () => ({ width: 612, height: 792 }),
          }),
        }),
      }),
    });

    expect(result).toMatchObject({
      fileName: 'synthetic-resume.pdf',
      pageCount: 1,
      inspection: {
        parser: 'pdfjs-fallback',
        documentKind: 'native_text',
        route: 'direct_text',
      },
    });
    expect(result.text).toContain('Synthetic resume evidence');
  });

  it('rejects non-PDF files before reading their bytes', async () => {
    const file = new File(['not a pdf'], 'synthetic.txt', {
      type: 'text/plain',
    });
    await expect(extractPdfResume(file)).rejects.toThrow('Выберите PDF-файл.');
  });
});
