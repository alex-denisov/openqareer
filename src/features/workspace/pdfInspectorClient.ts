import { z } from 'zod';
import {
  MAX_PDF_INSPECTION_BYTES,
  type PdfInspection,
} from './pdfInspector';

const workerResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    requestId: z.string().min(1).max(100),
    inspection: z.object({
      parser: z.literal('pdf-inspector-wasm'),
      parserVersion: z.string().min(1).max(100),
      documentKind: z.enum(['native_text', 'scanned', 'mixed']),
      pageCount: z.number().int().min(1).max(10_000),
      text: z.string().max(5_000_000),
      confidence: z.number().finite().min(0).max(1),
      pagesNeedingOcr: z.array(z.number().int().min(1).max(10_000)).max(10_000),
      ocrReasonsByPage: z
        .array(
          z.object({
            page: z.number().int().min(1).max(10_000),
            reasons: z.array(z.string().min(1).max(200)).max(100),
          }),
        )
        .max(10_000),
      pagesWithColumns: z.array(z.number().int().min(1).max(10_000)).max(10_000),
      pagesWithTables: z.array(z.number().int().min(1).max(10_000)).max(10_000),
      hasEncodingIssues: z.boolean(),
      instructionSignals: z
        .array(
          z.object({
            pageNumber: z.number().int().min(1).max(10_000),
            kind: z.enum(['instruction_override', 'system_prompt_reference']),
          }),
        )
        .max(20_000),
      route: z.enum(['direct_text', 'ocr_required', 'hybrid_text_ocr']),
      requiresRenderedReview: z.boolean(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    requestId: z.string().min(1).max(100),
    code: z.enum(['invalid_request', 'inspection_failed']),
  }),
]);

interface WorkerMessageEvent {
  data: unknown;
}

export interface PdfInspectorWorker {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent) => void,
  ): void;
  addEventListener(type: 'error', listener: () => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent) => void,
  ): void;
  removeEventListener(type: 'error', listener: () => void): void;
}

export type PdfInspectorWorkerFactory = () => PdfInspectorWorker;

const WORKER_TIMEOUT_MS = 30_000;

export async function inspectPdfOffMainThread(
  bytes: Uint8Array,
  createWorker: PdfInspectorWorkerFactory = createDefaultWorker,
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<PdfInspection> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_INSPECTION_BYTES) {
    throw new Error('pdf_inspector_input_size_invalid');
  }
  const worker = createWorker();
  const requestId = crypto.randomUUID();
  const transferable = bytes.slice().buffer;
  return runWorkerInspection(worker, requestId, transferable, timeoutMs);
}

function runWorkerInspection(
  worker: PdfInspectorWorker,
  requestId: string,
  transferable: ArrayBuffer,
  timeoutMs: number,
): Promise<PdfInspection> {
  return new Promise<PdfInspection>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
      callback();
    };
    const onMessage = (event: WorkerMessageEvent) => {
      const parsed = workerResponseSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.requestId !== requestId) return;
      const response = parsed.data;
      if (response.ok === true) {
        finish(() => resolve(response.inspection));
        return;
      }
      finish(() => reject(new Error(`pdf_inspector_${response.code}`)));
    };
    const onError = () => {
      finish(() => reject(new Error('pdf_inspector_worker_failed')));
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('pdf_inspector_worker_timeout')));
    }, timeoutMs);

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    try {
      worker.postMessage(
        { requestId, bytes: transferable },
        [transferable],
      );
    } catch {
      finish(() => reject(new Error('pdf_inspector_worker_failed')));
    }
  });
}

function createDefaultWorker(): PdfInspectorWorker {
  return new Worker(new URL('./pdfInspector.worker.ts', import.meta.url), {
    type: 'module',
    name: 'openqareer-pdf-inspector',
  });
}
