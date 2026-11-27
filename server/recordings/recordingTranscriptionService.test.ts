import { describe, expect, it, vi } from 'vitest';
import { SealedText } from '../data/sealedText';
import { recordingRepositoryForTests } from '../testHelpers/recordingRepositoryForTests';
import {
  TranscriberUnavailableError,
  WhisperHttpError,
  type RecordingTranscriber,
} from '../providers/whisperTranscriber';
import { RecordingTranscriptionService } from './recordingTranscriptionService';

const log = { info: vi.fn(), warn: vi.fn() };

function setup(transcriber: RecordingTranscriber) {
  const repository = recordingRepositoryForTests();
  const sealed = new SealedText(Buffer.alloc(32, 3));
  const service = new RecordingTranscriptionService(repository, sealed, transcriber, log, 50);
  const recordingId = repository.create({
    candidateId: 'c',
    applicationId: 'a',
    interviewId: 'i',
    tokenHash: 'ab',
    tokenExpiresAt: '2030-01-01T00:00:00.000Z',
  });
  const add = (segment: number) => {
    repository.insertSegmentIfNew({
      recordingId,
      track: 'mic',
      segment,
      startedAt: '2026-11-22T10:00:00.000Z',
      durationMs: 1,
    });
    service.enqueue({
      recordingId,
      track: 'mic',
      segment,
      format: 'm4a',
      audio: Buffer.from('audio'),
    });
  };
  return { repository, service, recordingId, add };
}

describe('RecordingTranscriptionService', () => {
  it('держит в полёте не больше двух вызовов и опустошает очередь', async () => {
    let inFlight = 0;
    let peak = 0;
    const { service, add, repository, recordingId } = setup(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return [{ start: 0, end: 1, text: 'т' }];
    });
    [0, 1, 2, 3, 4].forEach(add);
    await service.idle();
    expect(peak).toBe(2);
    expect(service.pending()).toBe(0);
    expect(repository.listSegments(recordingId).every((s) => s.status === 'done')).toBe(true);
  });

  it.each([
    ['transcriber_unavailable', () => new TranscriberUnavailableError()],
    ['transcription_failed', () => new WhisperHttpError(500)],
  ])('сбой %s: сегмент failed с этим кодом', async (code, make) => {
    const { service, add, repository, recordingId } = setup(async () => {
      throw make();
    });
    add(0);
    await service.idle();
    expect(service.pending()).toBe(0);
    const row = repository.listSegments(recordingId)[0]!;
    expect(row.status).toBe('failed');
    const logged = JSON.stringify(log.info.mock.calls);
    expect(logged).toContain(code);
    expect(logged).not.toContain('audio');
  });

  it('зависший вызов обрывается по таймауту', async () => {
    const { service, add, repository, recordingId } = setup(
      (_audio, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    add(0);
    await service.idle();
    expect(repository.listSegments(recordingId)[0]!.status).toBe('failed');
  });

  it('после перезапуска зависшие сегменты помечаются interrupted', () => {
    const { repository, recordingId } = setup(async () => []);
    repository.insertSegmentIfNew({
      recordingId,
      track: 'system',
      segment: 9,
      startedAt: '2026-11-22T10:00:00.000Z',
      durationMs: 1,
    });
    expect(repository.failInterrupted('2999-01-01T00:00:00.000Z')).toBe(1);
    expect(repository.listSegments(recordingId).find((s) => s.segment === 9)?.status).toBe(
      'failed',
    );
  });

  it('держит в памяти не больше заданного объёма аудио: сверх него места нет', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const repository = recordingRepositoryForTests();
    const service = new RecordingTranscriptionService(
      repository,
      new SealedText(Buffer.alloc(32, 3)),
      async () => {
        await gate;
        return [];
      },
      log,
      50,
      10,
    );
    expect(service.hasRoomFor(10)).toBe(true);
    service.enqueue({
      recordingId: 'r',
      track: 'mic',
      segment: 0,
      format: 'm4a',
      audio: Buffer.alloc(6),
    });
    expect(service.hasRoomFor(4)).toBe(true);
    expect(service.hasRoomFor(5)).toBe(false);
    release();
    await service.idle();
    expect(service.hasRoomFor(10)).toBe(true);
  });

  it('бронирует память до чтения тела: без места брони нет, отпущенная бронь освобождает', () => {
    const repository = recordingRepositoryForTests();
    const service = new RecordingTranscriptionService(
      repository,
      new SealedText(Buffer.alloc(32, 3)),
      async () => [],
      log,
      50,
      10,
    );
    const first = service.reserve(6);
    expect(first).not.toBeNull();
    expect(service.reserve(5)).toBeNull();
    first!();
    expect(service.reserve(10)).not.toBeNull();
  });
});
