import type { FastifyBaseLogger } from 'fastify';
import type { RouteDeps } from '../routes/deps';
import { SealedText } from '../data/sealedText';
import { SqliteInterviewRecordingRepository } from '../data/sqliteInterviewRecordingRepository';
import { createWhisperTranscriber } from '../providers/whisperTranscriber';
import { RecordingTranscriptionService, STALE_SEGMENT_MS } from './recordingTranscriptionService';

export interface RecordingRuntime {
  readonly repository: SqliteInterviewRecordingRepository;
  readonly service: RecordingTranscriptionService;
  readonly sealedText: SealedText;
  close(): void;
}

const runtimes = new WeakMap<RouteDeps, RecordingRuntime>();

/** Закрыть, только если открывали: создание при остановке пометило бы чужие сегменты. */
export function closeRecordingRuntime(deps: RouteDeps): void {
  runtimes.get(deps)?.close();
}

/** Сегменты, которые прошлый или упавший процесс уже не доделает. */
export function failStaleSegments(runtime: RecordingRuntime, now = Date.now()): void {
  runtime.repository.failInterrupted(new Date(now - STALE_SEGMENT_MS).toISOString());
}

/** Хранилище и очередь записей: одни на приложение, открываются при первом обращении. */
export function recordingRuntimeFor(
  deps: RouteDeps,
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): RecordingRuntime {
  const existing = runtimes.get(deps);
  if (existing) return existing;
  const repository = new SqliteInterviewRecordingRepository({
    databasePath: deps.config.databasePath,
  });
  const sealedText = new SealedText(deps.config.dataEncryptionKey);
  const transcriber = deps.recordingTranscriber ?? createWhisperTranscriber(deps.config);
  const service = new RecordingTranscriptionService(repository, sealedText, transcriber, log);
  const runtime: RecordingRuntime = {
    repository,
    service,
    sealedText,
    close: () => {
      runtimes.delete(deps);
      repository.close();
    },
  };
  runtimes.set(deps, runtime);
  return runtime;
}

/** Адрес, по которому приложение достучится до сервера; в проде https://openqareer.com. */
export function publicOrigin(config: RouteDeps['config']): string {
  const base = config.publicBaseUrl ?? config.allowedOrigins[0] ?? '';
  return base.replace(/\/+$/, '');
}
