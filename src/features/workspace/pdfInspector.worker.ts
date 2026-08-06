import { z } from 'zod';
import {
  inspectPdfBytes,
  MAX_PDF_INSPECTION_BYTES,
} from './pdfInspector';

const requestSchema = z.object({
  requestId: z.string().min(1).max(100),
  bytes: z
    .instanceof(ArrayBuffer)
    .refine(
      (bytes) =>
        bytes.byteLength > 0 && bytes.byteLength <= MAX_PDF_INSPECTION_BYTES,
    ),
});

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  void handleInspectionRequest(event.data);
});

async function handleInspectionRequest(message: unknown): Promise<void> {
  const request = requestSchema.safeParse(message);
  if (!request.success) {
    const requestId = z
      .object({ requestId: z.string().min(1).max(100) })
      .safeParse(message);
    self.postMessage({
      ok: false,
      requestId: requestId.success ? requestId.data.requestId : 'invalid',
      code: 'invalid_request',
    });
    return;
  }

  try {
    const inspection = await inspectPdfBytes(new Uint8Array(request.data.bytes));
    self.postMessage({
      ok: true,
      requestId: request.data.requestId,
      inspection,
    });
  } catch {
    self.postMessage({
      ok: false,
      requestId: request.data.requestId,
      code: 'inspection_failed',
    });
  }
}
