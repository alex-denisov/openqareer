import { describe, expect, it, vi } from 'vitest';
import {
  inspectPdfOffMainThread,
  type PdfInspectorWorker,
} from './pdfInspectorClient';

class FakeWorker implements PdfInspectorWorker {
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();
  private messageListeners = new Set<(event: { data: unknown }) => void>();
  private errorListeners = new Set<() => void>();

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: { data: unknown }) => void);
    } else {
      this.errorListeners.add(listener as () => void);
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: { data: unknown }) => void);
    } else {
      this.errorListeners.delete(listener as () => void);
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data });
  }

  emitError(): void {
    for (const listener of this.errorListeners) listener();
  }
}

const nativeInspection = {
  parser: 'pdf-inspector-wasm' as const,
  parserVersion: '0.1.3-test',
  documentKind: 'native_text' as const,
  pageCount: 1,
  text: 'Synthetic candidate evidence that is safely long enough for import.',
  confidence: 0.98,
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  pagesWithColumns: [],
  pagesWithTables: [],
  hasEncodingIssues: false,
  instructionSignals: [],
  route: 'direct_text' as const,
  requiresRenderedReview: false,
};

describe('PDF inspector worker client', () => {
  it('accepts only the matching, validated worker response and terminates', async () => {
    const worker = new FakeWorker();
    const resultPromise = inspectPdfOffMainThread(
      new Uint8Array([37, 80, 68, 70]),
      () => worker,
      1_000,
    );
    const request = worker.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
      bytes: ArrayBuffer;
    };

    worker.emitMessage({
      ok: true,
      requestId: 'unrelated-request',
      inspection: nativeInspection,
    });
    worker.emitMessage({
      ok: true,
      requestId: request.requestId,
      inspection: nativeInspection,
    });

    await expect(resultPromise).resolves.toEqual(nativeInspection);
    expect(request.bytes.byteLength).toBe(4);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects explicit worker failures without returning document content', async () => {
    const worker = new FakeWorker();
    const resultPromise = inspectPdfOffMainThread(
      new Uint8Array([37, 80, 68, 70]),
      () => worker,
      1_000,
    );
    const request = worker.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };

    worker.emitMessage({
      ok: false,
      requestId: request.requestId,
      code: 'inspection_failed',
    });

    await expect(resultPromise).rejects.toThrow(
      'pdf_inspector_inspection_failed',
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a worker that exceeds its bounded execution time', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const resultPromise = inspectPdfOffMainThread(
      new Uint8Array([37, 80, 68, 70]),
      () => worker,
      25,
    );
    const rejection = expect(resultPromise).rejects.toThrow(
      'pdf_inspector_worker_timeout',
    );

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('terminates a worker when transfer setup fails synchronously', async () => {
    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error('synthetic transfer failure');
    });

    await expect(
      inspectPdfOffMainThread(
        new Uint8Array([37, 80, 68, 70]),
        () => worker,
        1_000,
      ),
    ).rejects.toThrow('pdf_inspector_worker_failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
