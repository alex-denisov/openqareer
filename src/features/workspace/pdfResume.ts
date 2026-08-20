import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  classifyPdfDocument,
  type PdfPageObservation,
} from './pdfDocumentClassifier';
import type { PdfInspection } from './pdfInspector';
import { inspectPdfOffMainThread } from './pdfInspectorClient';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 40;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform?: unknown[];
  width?: number;
  height?: number;
}

interface PdfMarkedContent {
  type: string;
}

export interface ExtractedPdfResume {
  fileName: string;
  pageCount: number;
  text: string;
  inspection: PdfResumeInspection;
}

export interface PdfResumeInspection {
  parser: 'pdf-inspector-wasm' | 'pdfjs-fallback';
  parserVersion: string;
  documentKind: 'native_text' | 'scanned' | 'mixed' | 'malformed';
  route: 'direct_text' | 'ocr_required' | 'hybrid_text_ocr' | 'manual_review';
  confidence: number;
  pagesNeedingOcr: number[];
  pagesWithColumns: number[];
  pagesWithTables: number[];
  hasEncodingIssues: boolean;
  instructionSignals: Array<{
    pageNumber: number;
    kind: 'instruction_override' | 'system_prompt_reference';
  }>;
  requiresRenderedReview: boolean;
}

export type PdfResumeImportErrorCode =
  | 'too_many_pages'
  | 'ocr_required'
  | 'hybrid_ocr_required'
  | 'manual_review_required'
  | 'insufficient_text';

export class PdfResumeImportError extends Error {
  constructor(
    readonly code: PdfResumeImportErrorCode,
    message: string,
    readonly inspection?: PdfResumeInspection,
  ) {
    super(message);
    this.name = 'PdfResumeImportError';
  }
}

interface PdfJsPage {
  getTextContent(): Promise<{ items: Array<PdfTextItem | PdfMarkedContent> }>;
  getOperatorList(): Promise<{ fnArray: number[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
}

export interface PdfJsAdapter {
  version: string;
  imageOperatorCodes: number[];
  open(bytes: Uint8Array): Promise<{
    numPages: number;
    getPage(pageNumber: number): Promise<PdfJsPage>;
  }>;
}

export interface PdfResumeDependencies {
  inspect?: (bytes: Uint8Array) => Promise<PdfInspection>;
  loadPdfJs?: () => Promise<PdfJsAdapter>;
}

export async function extractPdfResume(
  file: File,
  dependencies: PdfResumeDependencies = {},
): Promise<ExtractedPdfResume> {
  if (!isPdfFile(file)) {
    throw new Error('Выберите PDF-файл.');
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error('PDF больше 20 МБ. Сохраните более компактную копию.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const inspection = await (dependencies.inspect ?? inspectPdfOffMainThread)(
      bytes,
    );
    return importFromInspection(file.name, inspection);
  } catch (error) {
    if (error instanceof PdfResumeImportError) throw error;
    return extractWithPdfJsFallback(
      file.name,
      bytes,
      dependencies.loadPdfJs ?? loadDefaultPdfJs,
    );
  }
}

export function importFromInspection(
  fileName: string,
  inspection: PdfInspection,
): ExtractedPdfResume {
  if (inspection.pageCount > MAX_PDF_PAGES) {
    throw new PdfResumeImportError(
      'too_many_pages',
      'В PDF больше 40 страниц. Выберите именно резюме.',
      inspection,
    );
  }
  if (inspection.route === 'ocr_required') {
    throw new PdfResumeImportError(
      'ocr_required',
      ocrRequiredMessage('scanned', inspection.pagesNeedingOcr),
      inspection,
    );
  }
  if (inspection.route === 'hybrid_text_ocr') {
    throw new PdfResumeImportError(
      'hybrid_ocr_required',
      ocrRequiredMessage('mixed', inspection.pagesNeedingOcr),
      inspection,
    );
  }

  const text = inspection.text.trim();
  if (text.length < 80) {
    throw new PdfResumeImportError(
      'insufficient_text',
      'В PDF слишком мало читаемого текста. Используйте PDF с текстовым слоем или запасной ввод.',
      inspection,
    );
  }

  return {
    fileName,
    pageCount: inspection.pageCount,
    text,
    inspection,
  };
}

async function extractWithPdfJsFallback(
  fileName: string,
  bytes: Uint8Array,
  loadPdfJs: () => Promise<PdfJsAdapter>,
): Promise<ExtractedPdfResume> {
  const pdfJs = await loadPdfJs();
  const document = await pdfJs.open(bytes);
  if (document.numPages > MAX_PDF_PAGES) {
    throw new PdfResumeImportError(
      'too_many_pages',
      'В PDF больше 40 страниц. Выберите именно резюме.',
    );
  }
  const extracted = await extractPdfJsPages(
    document,
    new Set(pdfJs.imageOperatorCodes),
  );
  const text = extracted.pages.filter(Boolean).join('\n\n').trim();
  const inspection = createFallbackInspection(
    classifyPdfDocument(extracted.observations),
    pdfJs.version,
  );
  assertFallbackImportable(inspection, text);
  return { fileName, pageCount: document.numPages, text, inspection };
}

async function extractPdfJsPages(
  document: Awaited<ReturnType<PdfJsAdapter['open']>>,
  imageOperators: Set<number>,
): Promise<{ pages: string[]; observations: PdfPageObservation[] }> {
  const pages: string[] = [];
  const observations: PdfPageObservation[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const observed = await observePdfJsPage(page, pageNumber, imageOperators);
    pages.push(observed.text);
    observations.push(observed.observation);
  }
  return { pages, observations };
}

async function observePdfJsPage(
  page: PdfJsPage,
  pageNumber: number,
  imageOperators: Set<number>,
): Promise<{ text: string; observation: PdfPageObservation }> {
  const [content, operatorList] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const viewport = page.getViewport({ scale: 1 });
  const items = content.items;
  return {
    text: normalizeExtractedPageText(items),
    observation: {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      imageCount: operatorList.fnArray.filter((operator) =>
        imageOperators.has(operator),
      ).length,
      textItems: items.flatMap(pdfTextObservation),
    },
  };
}

function pdfTextObservation(item: PdfTextItem | PdfMarkedContent) {
  if (!('str' in item)) return [];
  return [
    {
      str: item.str,
      x: finiteNumber(item.transform?.[4]),
      y: finiteNumber(item.transform?.[5]),
      width: nonNegativeNumber(item.width),
      height: nonNegativeNumber(item.height),
    },
  ];
}

function createFallbackInspection(
  classification: ReturnType<typeof classifyPdfDocument>,
  parserVersion: string,
): PdfResumeInspection {
  return {
    parser: 'pdfjs-fallback',
    parserVersion,
    documentKind: classification.documentKind,
    route: classification.route,
    confidence:
      classification.confidence === 'high'
        ? 0.9
        : classification.confidence === 'medium'
          ? 0.65
          : 0.3,
    pagesNeedingOcr: classification.pages
      .filter((page) =>
        page.contentKind === 'scanned' || page.contentKind === 'mixed',
      )
      .map((page) => page.pageNumber),
    pagesWithColumns: classification.pages
      .filter((page) => page.layout === 'multi_column')
      .map((page) => page.pageNumber),
    pagesWithTables: [],
    hasEncodingIssues: false,
    instructionSignals: classification.instructionSignals,
    requiresRenderedReview: classification.requiresRenderedReview,
  };
}

function assertFallbackImportable(
  inspection: PdfResumeInspection,
  text: string,
): void {
  if (inspection.route === 'ocr_required') {
    throw new PdfResumeImportError(
      'ocr_required',
      ocrRequiredMessage('scanned', inspection.pagesNeedingOcr),
      inspection,
    );
  }
  if (inspection.route === 'hybrid_text_ocr' && text.length < 250) {
    throw new PdfResumeImportError(
      'hybrid_ocr_required',
      ocrRequiredMessage('mixed', inspection.pagesNeedingOcr),
      inspection,
    );
  }
  if (inspection.route === 'manual_review') {
    throw new PdfResumeImportError(
      'manual_review_required',
      'Структуру PDF не удалось надёжно прочитать. Нужен другой файл или ручная проверка.',
      inspection,
    );
  }
  if (text.length < 80) {
    throw new PdfResumeImportError(
      'insufficient_text',
      'В PDF слишком мало читаемого текста. Используйте PDF с текстовым слоем или запасной ввод.',
      inspection,
    );
  }
}

// eslint-disable-next-line max-lines-per-function
export function normalizeExtractedPageText(
  items: Array<PdfTextItem | PdfMarkedContent>,
): string {
  const textItems = items.filter(
    (item): item is PdfTextItem =>
      'str' in item && typeof item.str === 'string' && item.str.trim().length > 0,
  );

  if (textItems.length === 0) return '';

  const hasTransforms = textItems.some(
    (item) =>
      Array.isArray(item.transform) &&
      item.transform.length >= 6 &&
      typeof item.transform[4] === 'number' &&
      typeof item.transform[5] === 'number',
  );

  if (hasTransforms) {
    const leftItems = textItems.filter(
      (it) => ((it.transform?.[4] as number) ?? 0) < 200,
    );
    const rightItems = textItems.filter(
      (it) => ((it.transform?.[4] as number) ?? 0) >= 200,
    );

    const isLinkedInSidebarPage =
      leftItems.length >= 4 &&
      rightItems.length >= 4 &&
      leftItems.some((it) =>
        /Contact|Top Skills|Languages|Certifications/i.test(it.str),
      );

    if (isLinkedInSidebarPage) {
      leftItems.sort(
        (a, b) =>
          ((b.transform?.[5] as number) ?? 0) -
          ((a.transform?.[5] as number) ?? 0),
      );
      rightItems.sort(
        (a, b) =>
          ((b.transform?.[5] as number) ?? 0) -
          ((a.transform?.[5] as number) ?? 0),
      );

      const rightText = rightItems.map((it) => it.str.trim()).filter(Boolean).join('\n');
      const leftText = leftItems.map((it) => it.str.trim()).filter(Boolean).join('\n');
      return `${rightText}\n\n${leftText}`;
    }

    const lines: Array<{ y: number; items: PdfTextItem[] }> = [];
    const sortedByY = [...textItems].sort(
      (a, b) =>
        ((b.transform?.[5] as number) ?? 0) -
        ((a.transform?.[5] as number) ?? 0),
    );

    for (const item of sortedByY) {
      const y = (item.transform?.[5] as number) ?? 0;
      let matchedLine = lines.find((l) => Math.abs(l.y - y) <= 4);
      if (!matchedLine) {
        matchedLine = { y, items: [] };
        lines.push(matchedLine);
      }
      matchedLine.items.push(item);
    }

    lines.sort((a, b) => b.y - a.y);

    return lines
      .map((line) => {
        line.items.sort(
          (a, b) =>
            ((a.transform?.[4] as number) ?? 0) -
            ((b.transform?.[4] as number) ?? 0),
        );
        return line.items
          .map((it) => it.str.trim())
          .filter(Boolean)
          .join(' ');
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return items
    .flatMap((item) =>
      'str' in item ? [`${item.str}${item.hasEOL ? '\n' : ' '}`] : [],
    )
    .join('')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

function formatPageList(pages: number[]): string {
  if (pages.length === 0) return 'с нераспознанным содержимым';
  return [...new Set(pages)].sort((a, b) => a - b).join(', ');
}

function ocrRequiredMessage(
  kind: 'scanned' | 'mixed',
  pages: number[],
): string {
  const pageList = formatPageList(pages);
  return kind === 'scanned'
    ? `Это скан: нужен OCR для страниц ${pageList}. ` +
        'Исходный файл не был принят как полное резюме.'
    : `Часть PDF читается, но для страниц ${pageList} нужен OCR. ` +
        'Частичный текст не был принят как полное резюме.';
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nonNegativeNumber(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

async function loadDefaultPdfJs(): Promise<PdfJsAdapter> {
  const pdfjs =
    typeof window === 'undefined'
      ? await import('pdfjs-dist/legacy/build/pdf.mjs')
      : await import('pdfjs-dist');
  const { getDocument, GlobalWorkerOptions, OPS, version } = pdfjs;
  if (GlobalWorkerOptions && workerSrc) {
    GlobalWorkerOptions.workerSrc = workerSrc;
  }
  return {
    version,
    imageOperatorCodes: [
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintInlineImageXObjectGroup,
      OPS.paintImageXObjectRepeat,
      OPS.paintImageMaskXObjectRepeat,
    ],
    open: async (bytes) => getDocument({ data: bytes }).promise,
  };
}
