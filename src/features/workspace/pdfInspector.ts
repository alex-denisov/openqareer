import { z } from 'zod';
import pdfInspectorWasmUrl from '@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm?url';
import { loadPdfEngineBytes } from './pdfEnginePayload';

export const MAX_PDF_INSPECTION_BYTES = 20 * 1024 * 1024;

const inspectorResultSchema = z
  .object({
    pdfType: z.enum(['TextBased', 'Scanned', 'ImageBased', 'Mixed']),
    markdown: z.string().max(5_000_000).optional(),
    pageCount: z.number().int().min(1).max(10_000),
    processingTimeMs: z.number().finite().min(0),
    pagesNeedingOcr: z.array(z.number().int().min(1).max(10_000)).max(10_000),
    ocrReasonsByPage: z
      .array(
        z.object({
          page: z.number().int().min(1).max(10_000),
          reasons: z.array(z.string().min(1).max(200)).max(100),
        }),
      )
      .max(10_000),
    confidence: z.number().finite().min(0).max(1),
    layout: z.object({
      isComplex: z.boolean(),
      pagesWithTables: z.array(z.number().int().min(1).max(10_000)).max(10_000),
      pagesWithColumns: z.array(z.number().int().min(1).max(10_000)).max(10_000),
    }),
    hasEncodingIssues: z.boolean(),
  })
  .superRefine((result, context) => {
    const referencedPages = [
      ...result.pagesNeedingOcr,
      ...result.ocrReasonsByPage.map(({ page }) => page),
      ...result.layout.pagesWithTables,
      ...result.layout.pagesWithColumns,
    ];
    if (referencedPages.some((page) => page > result.pageCount)) {
      context.addIssue({
        code: 'custom',
        message: 'page_reference_out_of_range',
      });
    }
  });

type InspectorLibraryResult = z.input<typeof inspectorResultSchema>;

export interface PdfInspectorEngine {
  version(): string;
  processPdf(
    data: Uint8Array,
    options: {
      profile: 'compact';
      includePageMarkers: true;
      includeImages: false;
    },
  ): InspectorLibraryResult;
}

export type PdfInspectorLoader = () => Promise<PdfInspectorEngine>;

export interface PdfInspection {
  parser: 'pdf-inspector-wasm';
  parserVersion: string;
  documentKind: 'native_text' | 'scanned' | 'mixed';
  pageCount: number;
  text: string;
  confidence: number;
  pagesNeedingOcr: number[];
  ocrReasonsByPage: Array<{ page: number; reasons: string[] }>;
  pagesWithColumns: number[];
  pagesWithTables: number[];
  hasEncodingIssues: boolean;
  instructionSignals: Array<{
    pageNumber: number;
    kind: 'instruction_override' | 'system_prompt_reference';
  }>;
  route: 'direct_text' | 'ocr_required' | 'hybrid_text_ocr';
  requiresRenderedReview: boolean;
}

let defaultEnginePromise: Promise<PdfInspectorEngine> | null = null;

export async function inspectPdfBytes(
  bytes: Uint8Array,
  loadEngine: PdfInspectorLoader = loadDefaultEngine,
): Promise<PdfInspection> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_INSPECTION_BYTES) {
    throw new Error('pdf_inspector_input_size_invalid');
  }
  const engine = await loadEngine();
  const result = inspectorResultSchema.safeParse(
    engine.processPdf(bytes, {
      profile: 'compact',
      includePageMarkers: true,
      includeImages: false,
    }),
  );
  if (!result.success) {
    throw new Error('pdf_inspector_result_invalid');
  }
  return normalizeInspectorResult(result.data, engine.version());
}

function normalizeInspectorResult(
  value: z.infer<typeof inspectorResultSchema>,
  parserVersion: string,
): PdfInspection {
  const documentKind =
    value.pdfType === 'TextBased'
      ? 'native_text'
      : value.pdfType === 'Mixed'
        ? 'mixed'
        : 'scanned';
  const route =
    documentKind === 'native_text'
      ? 'direct_text'
      : documentKind === 'mixed'
        ? 'hybrid_text_ocr'
        : 'ocr_required';

  return {
    parser: 'pdf-inspector-wasm',
    parserVersion,
    documentKind,
    pageCount: value.pageCount,
    text: value.markdown?.trim() ?? '',
    confidence: value.confidence,
    pagesNeedingOcr: [...new Set(value.pagesNeedingOcr)].sort((a, b) => a - b),
    ocrReasonsByPage: value.ocrReasonsByPage,
    pagesWithColumns: value.layout.pagesWithColumns,
    pagesWithTables: value.layout.pagesWithTables,
    hasEncodingIssues: value.hasEncodingIssues,
    instructionSignals: detectInstructionSignals(value.markdown ?? ''),
    route,
    requiresRenderedReview:
      route !== 'direct_text' ||
      value.layout.isComplex ||
      value.hasEncodingIssues,
  };
}

function detectInstructionSignals(
  markdown: string,
): PdfInspection['instructionSignals'] {
  const signals: PdfInspection['instructionSignals'] = [];
  let pageNumber = 1;
  for (const line of markdown.split('\n')) {
    const marker = line.match(/<!--\s*Page\s+(\d+)\s*-->/iu);
    if (marker) {
      pageNumber = Number(marker[1]);
      continue;
    }
    if (
      /ignore\s+(all\s+)?previous\s+instructions?/iu.test(line) ||
      /игнорируй\s+(все\s+)?предыдущие\s+инструкции/iu.test(line)
    ) {
      signals.push({ pageNumber, kind: 'instruction_override' });
    }
    if (/system\s+prompt|системн(?:ый|ого)\s+промпт/iu.test(line)) {
      signals.push({ pageNumber, kind: 'system_prompt_reference' });
    }
  }
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.pageNumber}:${signal.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadDefaultEngine(): Promise<PdfInspectorEngine> {
  defaultEnginePromise ??= import('@firecrawl/pdf-inspector-wasm').then(
    async (module) => {
      // wasm-bindgen fetches the whole 4.8 MB engine in one response, and the
      // Russian route stops delivering after ~20 KB — PDF upload never started
      // there. The bytes arrive compressed, in parts, and are kept for the next
      // upload (PRB-013, B176).
      const bytes = await loadPdfEngineBytes(pdfInspectorWasmUrl);
      await module.default({ module_or_path: bytes });
      return {
        version: module.version,
        processPdf: module.processPdf,
      } satisfies PdfInspectorEngine;
    },
  );
  return defaultEnginePromise;
}
