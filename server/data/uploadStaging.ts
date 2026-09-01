/**
 * Приём файла частями.
 *
 * `POST /api/v1/candidate/documents` с телом в 86 КБ уходил на сервер целиком и
 * не получал ответа: маршрут владельца обрывает обмен примерно на 20 460 байт
 * и в эту сторону тоже (INC-031, та же стена, что в INC-029 и INC-030).
 * Поэтому файл приезжает частями внутри проверенного бюджета и собирается
 * здесь, в памяти процесса.
 *
 * Хранилище намеренно временное и незаписываемое на диск: незаконченная
 * загрузка — это не документ кандидата, и переживать перезапуск ей незачем.
 * Брошенные загрузки исчезают по сроку, чужие не отдаются никогда.
 */

export interface UploadPart {
  readonly uploadId: string;
  readonly index: number;
  readonly total: number;
  readonly part: string;
}

interface StagedUpload {
  readonly candidateId: string;
  readonly parts: Map<number, string>;
  readonly total: number;
  bytes: number;
  expiresAt: number;
}

export interface UploadStagingOptions {
  readonly maxBytes: number;
  readonly ttlMs: number;
  /** Сколько незаконченных загрузок продукт держит одновременно. */
  readonly maxUploads?: number;
}

const DEFAULT_MAX_UPLOADS = 32;

export class UploadStaging {
  private readonly uploads = new Map<string, StagedUpload>();

  constructor(private readonly options: UploadStagingOptions) {}

  accept(
    candidateId: string,
    part: UploadPart,
    now: number = Date.now(),
  ): { received: number; complete: boolean } {
    this.sweep(now);
    const existing = this.uploads.get(part.uploadId);
    if (existing && existing.candidateId !== candidateId) {
      throw new Error('Загрузка принадлежит другому кандидату.');
    }
    if (!existing && this.uploads.size >= (this.options.maxUploads ?? DEFAULT_MAX_UPLOADS)) {
      throw new Error('Слишком много незаконченных загрузок.');
    }

    const upload: StagedUpload = existing ?? {
      candidateId,
      parts: new Map<number, string>(),
      total: part.total,
      bytes: 0,
      expiresAt: now + this.options.ttlMs,
    };
    if (upload.total !== part.total) {
      throw new Error('Число частей изменилось посреди загрузки.');
    }

    // Повтор той же части не удваивает файл: сеть рвётся, и клиент шлёт её
    // заново.
    const previous = upload.parts.get(part.index)?.length ?? 0;
    const nextBytes = upload.bytes - previous + part.part.length;
    if (nextBytes > this.options.maxBytes) {
      this.uploads.delete(part.uploadId);
      throw new Error('Файл больше разрешённого размера.');
    }

    upload.parts.set(part.index, part.part);
    upload.bytes = nextBytes;
    upload.expiresAt = now + this.options.ttlMs;
    this.uploads.set(part.uploadId, upload);

    return { received: upload.parts.size, complete: upload.parts.size === upload.total };
  }

  /** Отдаёт собранный файл ровно один раз и забывает его. */
  take(candidateId: string, uploadId: string, now: number = Date.now()): string | undefined {
    this.sweep(now);
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.candidateId !== candidateId) return undefined;
    if (upload.parts.size !== upload.total) return undefined;

    const ordered = [...upload.parts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value);
    this.uploads.delete(uploadId);
    return ordered.join('');
  }

  private sweep(now: number): void {
    for (const [uploadId, upload] of this.uploads) {
      if (upload.expiresAt <= now) this.uploads.delete(uploadId);
    }
  }
}
