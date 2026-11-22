import { DatabaseSync } from 'node:sqlite';
import type { FastifyBaseLogger } from 'fastify';
import type { RouteDeps } from '../routes/deps';
import { SealedText } from '../data/sealedText';
import { SqliteInterviewRecordingRepository } from '../data/sqliteInterviewRecordingRepository';
import { SqliteApplicationInterviewRepository } from '../data/sqliteApplicationInterviewRepository';
import {
  buildInterviewDebriefWriter,
  type InterviewDebriefWriter,
} from '../providers/interviewDebriefWriter';
import { createWhisperTranscriber } from '../providers/whisperTranscriber';
import { RecordingTranscriptionService, STALE_SEGMENT_MS } from './recordingTranscriptionService';

export interface RecordingRuntime {
  readonly repository: SqliteInterviewRecordingRepository;
  readonly service: RecordingTranscriptionService;
  readonly sealedText: SealedText;
  /** B751: интервью отклика для разбора (чтение; запись — через хранилище кандидата). */
  readonly interviews: SqliteApplicationInterviewRepository;
  readonly debriefWriter: InterviewDebriefWriter;
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
  const database = new DatabaseSync(deps.config.databasePath, { timeout: 5_000 });
  const runtime: RecordingRuntime = {
    repository,
    service,
    sealedText,
    interviews: new SqliteApplicationInterviewRepository(database, sealedText),
    debriefWriter: deps.interviewDebriefWriter ?? debriefWriterFor(deps, log),
    close: () => {
      runtimes.delete(deps);
      repository.close();
      database.close();
    },
  };
  runtimes.set(deps, runtime);
  return runtime;
}

/** Цепочка письма без Vertex; в журнал — только имя ошибки ступени. */
function debriefWriterFor(
  deps: RouteDeps,
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): InterviewDebriefWriter {
  return buildInterviewDebriefWriter(
    { providerCredentials: deps.config.providerCredentials, vertex: deps.config.vertex },
    (error) =>
      log.warn(
        { errorName: error instanceof Error ? error.name : 'unknown' },
        'interview-debrief-stage-failed',
      ),
  );
}

/** Адрес, по которому приложение достучится до сервера; в проде https://openqareer.com. */
export function publicOrigin(config: RouteDeps['config']): string {
  const base = config.publicBaseUrl ?? config.allowedOrigins[0] ?? '';
  return base.replace(/\/+$/, '');
}
