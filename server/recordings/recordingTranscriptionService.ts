import type { FastifyBaseLogger } from 'fastify';
import type {
  RecordingTrack,
  SqliteInterviewRecordingRepository,
} from '../data/sqliteInterviewRecordingRepository';
import type { SealedText } from '../data/sealedText';
import {
  TranscriberUnavailableError,
  WHISPER_TIMEOUT_MS,
  type AudioFormat,
  type RecordingTranscriber,
} from '../providers/whisperTranscriber';

export const MAX_CONCURRENT_TRANSCRIPTIONS = 2;
/** Аудио в памяти (очередь и полёт): 150 МБ — около 60 сегментов по 10 минут; потолок юнита 2 ГБ. */
export const MAX_QUEUED_AUDIO_BYTES = 150 * 1024 * 1024;
/** Сегмент, ждущий дольше, точно не в работе: очередь ограничена, вызов модели — 90 с. */
export const STALE_SEGMENT_MS = 10 * 60 * 1_000;

export interface SegmentJob {
  readonly recordingId: string;
  readonly track: RecordingTrack;
  readonly segment: number;
  readonly format: AudioFormat;
  readonly audio: Buffer;
}

interface QueuedJob {
  readonly recordingId: string;
  readonly track: RecordingTrack;
  readonly segment: number;
  readonly format: AudioFormat;
  /** Единственная ссылка на аудио; обнуляется сразу после вызова модели. */
  audio: Buffer | null;
}

export function segmentAssociatedData(
  job: Pick<SegmentJob, 'recordingId' | 'track' | 'segment'>,
): string {
  return `${job.recordingId}:${job.track}:${job.segment}`;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof TranscriberUnavailableError) return 'transcriber_unavailable';
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? 'transcription_timeout'
    : 'transcription_failed';
}

/** Очередь расшифровки: не больше двух вызовов модели разом, аудио только в памяти. */
export class RecordingTranscriptionService {
  private readonly queue: QueuedJob[] = [];
  private running = 0;
  private heldBytes = 0;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly repository: SqliteInterviewRecordingRepository,
    private readonly sealedText: SealedText,
    private readonly transcriber: RecordingTranscriber,
    private readonly log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
    private readonly timeoutMs = WHISPER_TIMEOUT_MS,
    private readonly maxHeldBytes = MAX_QUEUED_AUDIO_BYTES,
  ) {}

  /** Хватит ли памяти ещё на один сегмент; нет — приложение повторит позже. */
  hasRoomFor(bytes: number): boolean {
    return this.heldBytes + bytes <= this.maxHeldBytes;
  }

  /** Бронь памяти до чтения тела запроса; `null` — места нет. Возвращает функцию снятия брони. */
  reserve(bytes: number): (() => void) | null {
    if (!this.hasRoomFor(bytes)) return null;
    this.heldBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.heldBytes -= bytes;
    };
  }

  enqueue(job: SegmentJob): void {
    this.heldBytes += job.audio.length;
    this.queue.push({ ...job });
    this.pump();
  }

  /** Нет работы в очереди и в полёте; нужен тестам и остановке. */
  idle(): Promise<void> {
    if (this.queue.length === 0 && this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  pending(): number {
    return this.queue.length + this.running;
  }

  private pump(): void {
    while (this.running < MAX_CONCURRENT_TRANSCRIPTIONS && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running += 1;
      void this.run(job).finally(() => {
        this.running -= 1;
        this.pump();
        this.notifyIdle();
      });
    }
  }

  private notifyIdle(): void {
    if (this.queue.length > 0 || this.running > 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private async run(job: QueuedJob): Promise<void> {
    const startedAt = Date.now();
    const audio = job.audio!;
    job.audio = null;
    let outcome: { textCipher: string } | { errorCode: string };
    try {
      const lines = await this.transcriber(audio, AbortSignal.timeout(this.timeoutMs), job.format);
      outcome = {
        textCipher: this.sealedText.seal(JSON.stringify(lines), segmentAssociatedData(job)),
      };
    } catch (error) {
      outcome = { errorCode: errorCodeOf(error) };
    } finally {
      this.heldBytes -= audio.length;
    }
    this.store(job, outcome, Date.now() - startedAt);
  }

  private store(
    job: QueuedJob,
    outcome: { textCipher: string } | { errorCode: string },
    durationMs: number,
  ): void {
    const errorCode = 'errorCode' in outcome ? outcome.errorCode : null;
    try {
      this.repository.completeSegment(job, outcome);
      this.log.info(
        {
          recordingId: job.recordingId,
          track: job.track,
          segment: job.segment,
          outcome: errorCode ? 'failed' : 'done',
          durationMs,
          errorCode,
        },
        'interview-recording-segment',
      );
    } catch {
      this.log.warn(
        {
          recordingId: job.recordingId,
          track: job.track,
          segment: job.segment,
          outcome: 'store_failed',
          durationMs,
          errorCode: 'store_failed',
        },
        'interview-recording-segment',
      );
    }
  }
}
