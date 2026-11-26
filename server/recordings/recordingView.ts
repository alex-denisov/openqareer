import type { SealedText } from '../data/sealedText';
import type {
  RecordingTrack,
  SegmentStatus,
  StoredRecording,
  StoredSegment,
} from '../data/sqliteInterviewRecordingRepository';
import { segmentAssociatedData } from './recordingTranscriptionService';

export type RecordingStatus = 'recording' | 'transcribing' | 'ready' | 'failed';

export interface TranscriptLine {
  /** `null` — загруженный файл: голоса не разделены (B751). */
  readonly speaker: 'candidate' | 'interviewer' | null;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface RecordingView {
  readonly recordingId: string;
  readonly interviewId: string;
  readonly applicationId: string;
  readonly status: RecordingStatus;
  readonly segments: ReadonlyArray<{
    track: RecordingTrack;
    segment: number;
    startedAt: string;
    durationMs: number;
    status: SegmentStatus;
  }>;
  readonly transcript: TranscriptLine[] | null;
  readonly gaps: ReadonlyArray<{
    track: RecordingTrack;
    segment: number;
    startedAt: string;
    durationMs: number;
  }>;
}

export function recordingStatus(
  recording: Pick<StoredRecording, 'finishedAt'>,
  segments: readonly StoredSegment[],
): RecordingStatus {
  if (!recording.finishedAt) return 'recording';
  if (segments.some((s) => s.status === 'pending')) return 'transcribing';
  return segments.some((s) => s.status === 'done') ? 'ready' : 'failed';
}

function speakerOf(track: RecordingTrack): TranscriptLine['speaker'] {
  if (track === 'upload') return null;
  return track === 'mic' ? 'candidate' : 'interviewer';
}

function linesOf(
  sealedText: SealedText,
  segment: StoredSegment,
  recordingId: string,
  origin: number,
): TranscriptLine[] {
  const plain = sealedText.open(
    segment.textCipher!,
    segmentAssociatedData({ recordingId, track: segment.track, segment: segment.segment }),
  );
  const parsed = JSON.parse(plain) as Array<{ start: number; end: number; text: string }>;
  const offset = Date.parse(segment.startedAt) - origin;
  return parsed.map((line) => ({
    speaker: speakerOf(segment.track),
    startMs: Math.max(0, Math.round(offset + line.start * 1_000)),
    endMs: Math.max(0, Math.round(offset + line.end * 1_000)),
    text: line.text,
  }));
}

/** Реплики обеих дорожек по общему времени; отсчёт от начала самого раннего сегмента. */
export function assembleTranscript(
  sealedText: SealedText,
  recordingId: string,
  segments: readonly StoredSegment[],
): TranscriptLine[] {
  const origin = Math.min(...segments.map((s) => Date.parse(s.startedAt)));
  return segments
    .filter((s) => s.status === 'done' && s.textCipher)
    .flatMap((s) => linesOf(sealedText, s, recordingId, origin))
    .sort((a, b) => a.startMs - b.startMs || (a.speaker === 'candidate' ? -1 : 1));
}

export function buildRecordingView(
  sealedText: SealedText,
  recording: StoredRecording,
  segments: readonly StoredSegment[],
): RecordingView {
  const status = recordingStatus(recording, segments);
  return {
    recordingId: recording.id,
    interviewId: recording.interviewId,
    applicationId: recording.applicationId,
    status,
    segments: segments.map(({ track, segment, startedAt, durationMs, status: s }) => ({
      track,
      segment,
      startedAt,
      durationMs,
      status: s,
    })),
    transcript: status === 'ready' ? assembleTranscript(sealedText, recording.id, segments) : null,
    gaps: segments
      .filter((s) => s.status === 'failed')
      .map(({ track, segment, startedAt, durationMs }) => ({
        track,
        segment,
        startedAt,
        durationMs,
      })),
  };
}
