import { z } from 'zod';

const textItemSchema = z.object({
  str: z.string().max(20_000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});

const pageObservationSchema = z.object({
  pageNumber: z.number().int().min(1).max(10_000),
  width: z.number().finite().min(0).max(100_000),
  height: z.number().finite().min(0).max(100_000),
  imageCount: z.number().int().min(0).max(100_000),
  textItems: z.array(textItemSchema).max(100_000),
});

export type PdfPageObservation = z.input<typeof pageObservationSchema>;
type PageContentKind = 'native_text' | 'scanned' | 'mixed' | 'malformed';
type PageLayout = 'single_column' | 'multi_column' | 'unknown';

interface ClassifiedPage {
  pageNumber: number;
  contentKind: PageContentKind;
  layout: PageLayout;
  textCharacterCount: number;
  imageCount: number;
  provenance:
    | 'pdf_page_text_layer'
    | 'pdf_page_image'
    | 'pdf_page_text_and_image'
    | 'pdf_page_unreadable';
}

export interface PdfDocumentClassification {
  documentKind: 'native_text' | 'scanned' | 'mixed' | 'malformed';
  layout: 'single_column' | 'multi_column' | 'mixed' | 'unknown';
  route: 'direct_text' | 'ocr_required' | 'hybrid_text_ocr' | 'manual_review';
  confidence: 'high' | 'medium' | 'low';
  requiresRenderedReview: boolean;
  pageCount: number;
  textCharacterCount: number;
  instructionSignals: Array<{
    pageNumber: number;
    kind: 'instruction_override' | 'system_prompt_reference';
  }>;
  pages: ClassifiedPage[];
}

export function classifyPdfDocument(
  input: PdfPageObservation[],
): PdfDocumentClassification {
  const observations = z.array(pageObservationSchema).max(10_000).parse(input);
  const pages = observations.map(classifyPage);
  const documentKind = documentKindFromPages(pages);
  const layout = documentLayout(pages);
  const textCharacterCount = pages.reduce(
    (total, page) => total + page.textCharacterCount,
    0,
  );
  const instructionSignals = observations.flatMap(instructionSignalsForPage);

  return {
    documentKind,
    layout,
    route: routeForDocument(documentKind),
    confidence:
      documentKind === 'native_text' || documentKind === 'scanned'
        ? 'high'
        : documentKind === 'mixed'
          ? 'medium'
          : 'low',
    requiresRenderedReview:
      documentKind !== 'native_text' || layout !== 'single_column',
    pageCount: pages.length,
    textCharacterCount,
    instructionSignals: uniqueInstructionSignals(instructionSignals),
    pages,
  };
}

function classifyPage(
  page: z.infer<typeof pageObservationSchema>,
): ClassifiedPage {
  const textCharacterCount = page.textItems.reduce(
    (total, item) => total + item.str.trim().length,
    0,
  );
  const validPage = page.width > 0 && page.height > 0;
  const hasText = textCharacterCount >= 40;
  const hasImages = page.imageCount > 0;
  const contentKind: PageContentKind = !validPage
    ? 'malformed'
    : hasText && hasImages
      ? 'mixed'
      : hasText
        ? 'native_text'
        : hasImages
          ? 'scanned'
          : 'malformed';

  return {
    pageNumber: page.pageNumber,
    contentKind,
    layout:
      contentKind === 'native_text' || contentKind === 'mixed'
        ? detectPageLayout(page)
        : 'unknown',
    textCharacterCount,
    imageCount: page.imageCount,
    provenance:
      contentKind === 'native_text'
        ? 'pdf_page_text_layer'
        : contentKind === 'scanned'
          ? 'pdf_page_image'
          : contentKind === 'mixed'
            ? 'pdf_page_text_and_image'
            : 'pdf_page_unreadable',
  };
}

function detectPageLayout(
  page: z.infer<typeof pageObservationSchema>,
): PageLayout {
  const items = page.textItems.filter((item) => item.str.trim().length >= 2);
  if (items.length < 8) return 'single_column';
  const left = items.filter((item) => item.x < page.width * 0.45);
  const right = items.filter((item) => item.x > page.width * 0.55);
  if (left.length < 4 || right.length < 4) return 'single_column';
  const leftRange = verticalRange(left);
  const rightRange = verticalRange(right);
  const overlap = Math.max(
    0,
    Math.min(leftRange.max, rightRange.max) -
      Math.max(leftRange.min, rightRange.min),
  );
  const smallerRange = Math.min(
    leftRange.max - leftRange.min,
    rightRange.max - rightRange.min,
  );
  return smallerRange > 0 && overlap / smallerRange >= 0.5
    ? 'multi_column'
    : 'single_column';
}

function verticalRange(
  items: Array<z.infer<typeof textItemSchema>>,
): { min: number; max: number } {
  return items.reduce(
    (range, item) => ({
      min: Math.min(range.min, item.y),
      max: Math.max(range.max, item.y + item.height),
    }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  );
}

function documentKindFromPages(pages: ClassifiedPage[]): PdfDocumentClassification['documentKind'] {
  if (pages.length === 0 || pages.every((page) => page.contentKind === 'malformed')) {
    return 'malformed';
  }
  if (pages.every((page) => page.contentKind === 'native_text')) return 'native_text';
  if (pages.every((page) => page.contentKind === 'scanned')) return 'scanned';
  return 'mixed';
}

function documentLayout(pages: ClassifiedPage[]): PdfDocumentClassification['layout'] {
  const layouts = new Set(
    pages
      .map((page) => page.layout)
      .filter((layout): layout is Exclude<PageLayout, 'unknown'> => layout !== 'unknown'),
  );
  if (layouts.size === 0) return 'unknown';
  if (layouts.size > 1) return 'mixed';
  return layouts.has('multi_column') ? 'multi_column' : 'single_column';
}

function routeForDocument(
  kind: PdfDocumentClassification['documentKind'],
): PdfDocumentClassification['route'] {
  switch (kind) {
    case 'native_text':
      return 'direct_text';
    case 'scanned':
      return 'ocr_required';
    case 'mixed':
      return 'hybrid_text_ocr';
    case 'malformed':
      return 'manual_review';
  }
}

function instructionSignalsForPage(
  page: z.infer<typeof pageObservationSchema>,
): PdfDocumentClassification['instructionSignals'] {
  const text = page.textItems.map((item) => item.str).join(' ');
  const signals: PdfDocumentClassification['instructionSignals'] = [];
  if (
    /ignore\s+(all\s+)?previous\s+instructions?/iu.test(text) ||
    /игнорируй\s+(все\s+)?предыдущие\s+инструкции/iu.test(text)
  ) {
    signals.push({ pageNumber: page.pageNumber, kind: 'instruction_override' });
  }
  if (/system\s+prompt|системн(?:ый|ого)\s+промпт/iu.test(text)) {
    signals.push({ pageNumber: page.pageNumber, kind: 'system_prompt_reference' });
  }
  return signals;
}

function uniqueInstructionSignals(
  signals: PdfDocumentClassification['instructionSignals'],
): PdfDocumentClassification['instructionSignals'] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.pageNumber}:${signal.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
