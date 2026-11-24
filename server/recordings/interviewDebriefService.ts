import { createHash } from 'node:crypto';
import type { SealedText } from '../data/sealedText';
import type { StoredApplicationInterview } from '../data/sqliteApplicationInterviewRepository';
import type {
  SqliteInterviewRecordingRepository,
  StoredRecording,
} from '../data/sqliteInterviewRecordingRepository';
import { debriefMetrics, type DebriefFindings, type DebriefLine } from '../domain/interviewDebrief';
import type { DebriefAnalysis, InterviewDebriefView } from '../domain/interviewDebriefView';
import type { InterviewDebriefWriter } from '../providers/interviewDebriefWriter';
import { voicesAwaitConfirmation, type DebriefVoicesView } from '../domain/interviewDebriefView';
import type { VoiceId } from '../domain/interviewVoices';
import { buildRecordingView } from './recordingView';
import { voicedTranscript, voicesHash } from './recordingVoices';

/** B751: что нужно разбору — записи, ключ данных и цепочка письма. */
export interface DebriefContext {
  readonly repository: SqliteInterviewRecordingRepository;
  readonly sealedText: SealedText;
  readonly writer: InterviewDebriefWriter;
}

interface DebriefSubject {
  readonly candidateId: string;
  readonly interview: StoredApplicationInterview;
}

/** Интервью для разбора: последнее прошедшее по дате, иначе последнее созданное. */
export function debriefInterview(
  interviews: readonly StoredApplicationInterview[],
  now = Date.now(),
): StoredApplicationInterview | null {
  const past = interviews
    .filter((item) => item.scheduledAt && Date.parse(item.scheduledAt) <= now)
    .sort((a, b) => Date.parse(b.scheduledAt!) - Date.parse(a.scheduledAt!));
  if (past[0]) return past[0];
  const byCreation = [...interviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return byCreation[0] ?? null;
}

export function transcriptHash(lines: readonly DebriefLine[]): string {
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex');
}

export const findingsData = (recordingId: string, hash: string) => `${recordingId}:debrief:${hash}`;
export const interviewerData = (interviewId: string) => `${interviewId}:interviewer`;

type PartView = ReturnType<typeof buildRecordingView>;

interface RecordingState {
  readonly recording: StoredRecording;
  readonly view: Pick<PartView, 'status' | 'segments' | 'gaps' | 'transcript'>;
  /** Расшифровка файла до деления по голосам; у записи .app — та же, что в `view`. */
  readonly raw: PartView['transcript'];
  readonly voices: DebriefVoicesView | null;
}

/** Части одной записи: последняя и те, продолжением которых она шла (новее — первой). */
function partsOf(context: DebriefContext, latest: StoredRecording): StoredRecording[] {
  const parts = [latest];
  const seen = new Set([latest.id]);
  let next = latest.continuesId;
  while (next && !seen.has(next) && parts.length < 20) {
    const part = context.repository.getOwned(latest.candidateId, next);
    if (!part || part.interviewId !== latest.interviewId) break;
    parts.push(part);
    seen.add(part.id);
    next = part.continuesId;
  }
  return parts;
}

function combinedStatus(views: readonly PartView[]): PartView['status'] {
  const latest = views[0]!.status;
  if (latest === 'recording' || views.some((v) => v.status === 'transcribing')) {
    return latest === 'recording' ? 'recording' : 'transcribing';
  }
  return views.some((v) => v.status === 'ready') ? 'ready' : 'failed';
}

/** Реплики частей на общей шкале: отсчёт от начала самой ранней части. */
function combinedTranscript(views: readonly PartView[]): PartView['transcript'] {
  const starts = (v: PartView) => Math.min(...v.segments.map((seg) => Date.parse(seg.startedAt)));
  const origin = Math.min(...views.filter((v) => v.segments.length > 0).map(starts));
  return views
    .filter((v) => v.transcript && v.segments.length > 0)
    .flatMap((v) => {
      const shift = starts(v) - origin;
      return v.transcript!.map((line) => ({
        ...line,
        startMs: line.startMs + shift,
        endMs: line.endMs + shift,
      }));
    })
    .sort((a, b) => a.startMs - b.startMs);
}

function recordingState(context: DebriefContext, subject: DebriefSubject): RecordingState | null {
  const { repository, sealedText } = context;
  const recording = repository.latestForInterview(subject.candidateId, subject.interview.id);
  if (!recording) return null;
  const views = partsOf(context, recording).map((part) =>
    buildRecordingView(sealedText, part, repository.listSegments(part.id)),
  );
  const status = combinedStatus(views);
  const segments = views
    .flatMap((v) => v.segments)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const raw = status === 'ready' ? combinedTranscript(views) : null;
  const voiced =
    raw && recording.source === 'upload'
      ? voicedTranscript(context.repository, recording.id, raw)
      : null;
  return {
    recording,
    raw,
    voices: voiced?.voices ?? null,
    view: {
      status,
      segments,
      gaps: views.flatMap((v) => v.gaps),
      transcript: voiced?.lines ?? raw,
    },
  };
}

function analysisOf(context: DebriefContext, state: RecordingState | null): DebriefAnalysis {
  const lines = state?.view.transcript ?? [];
  if (!state || lines.length === 0) return { status: 'none' };
  const hash = transcriptHash(lines);
  const stored = context.repository.getAnalysis(state.recording.id, hash);
  if (!stored) return { status: 'none' };
  if (stored.status === 'failed' || !stored.findingsCipher) return { status: 'failed' };
  const plain = context.sealedText.open(
    stored.findingsCipher,
    findingsData(state.recording.id, hash),
  );
  return {
    status: 'ready',
    findings: JSON.parse(plain) as DebriefFindings,
    answeredBy: stored.answeredBy ?? '',
  };
}

function interviewerName(context: DebriefContext, subject: DebriefSubject): string | null {
  const cipher = context.repository.interviewerCipher(subject.candidateId, subject.interview.id);
  return cipher ? context.sealedText.open(cipher, interviewerData(subject.interview.id)) : null;
}

export function buildDebriefView(
  context: DebriefContext,
  subject: DebriefSubject,
): InterviewDebriefView {
  const state = recordingState(context, subject);
  const transcript = state?.view.transcript ?? [];
  return {
    interviewId: subject.interview.id,
    scheduledAt: subject.interview.scheduledAt,
    format: subject.interview.format,
    interviewerName: interviewerName(context, subject),
    recording: state
      ? {
          id: state.recording.id,
          status: state.view.status,
          source: state.recording.source === 'upload' ? 'upload' : 'app',
          startedAt: state.view.segments[0]?.startedAt ?? state.recording.createdAt,
          gaps: state.view.gaps.length,
        }
      : null,
    transcript,
    voices: state?.voices ?? null,
    metrics: transcript.length > 0 ? debriefMetrics(transcript) : null,
    analysis: analysisOf(context, state),
    notes: subject.interview.debrief,
  };
}

/**
 * Один вызов модели на расшифровку: готовый разбор берётся из кэша, сбой сохраняется
 * как `failed` и повторяется только по «Повторить разбор».
 */
export async function analyzeDebrief(
  context: DebriefContext,
  subject: DebriefSubject,
): Promise<InterviewDebriefView> {
  if (recordingState(context, subject)?.voices?.status === 'none') {
    await labelDebriefVoices(context, subject);
  }
  const state = recordingState(context, subject);
  const lines = state?.view.transcript ?? [];
  if (!state || lines.length === 0 || voicesAwaitConfirmation(state.voices)) {
    return buildDebriefView(context, subject);
  }
  const hash = transcriptHash(lines);
  if (context.repository.getAnalysis(state.recording.id, hash)?.status === 'ready') {
    return buildDebriefView(context, subject);
  }
  const outcome = await context.writer.writeDebrief(lines).catch(() => null);
  context.repository.saveAnalysis(
    state.recording.id,
    hash,
    outcome
      ? {
          status: 'ready',
          findingsCipher: context.sealedText.seal(
            JSON.stringify(outcome.findings),
            findingsData(state.recording.id, hash),
          ),
          answeredBy: outcome.answeredBy,
        }
      : { status: 'failed', findingsCipher: null, answeredBy: null },
  );
  return buildDebriefView(context, subject);
}

export function saveInterviewerName(
  context: DebriefContext,
  subject: DebriefSubject,
  name: string,
): void {
  const trimmed = name.trim();
  context.repository.setInterviewerCipher(
    subject.candidateId,
    subject.interview.id,
    trimmed ? context.sealedText.seal(trimmed, interviewerData(subject.interview.id)) : null,
  );
}

/** Деления в работе: второй запрос ждёт первый, иначе он сбросил бы подтверждённый голос. */
const voicesInFlight = new Map<string, Promise<void>>();

/** I4c: один вызов модели на расшифровку файла — голос каждой строки; сбой — «Повторить». */
export async function labelDebriefVoices(
  context: DebriefContext,
  subject: DebriefSubject,
): Promise<InterviewDebriefView> {
  const state = recordingState(context, subject);
  const raw = state?.raw ?? [];
  if (!state || state.recording.source !== 'upload' || raw.length === 0) {
    return buildDebriefView(context, subject);
  }
  if (state.voices?.status === 'ready') return buildDebriefView(context, subject);
  const key = `${state.recording.id}:${voicesHash(raw)}`;
  const running =
    voicesInFlight.get(key) ??
    splitVoices(context, state.recording.id, raw).finally(() => voicesInFlight.delete(key));
  voicesInFlight.set(key, running);
  await running;
  return buildDebriefView(context, subject);
}

async function splitVoices(
  context: DebriefContext,
  recordingId: string,
  raw: readonly DebriefLine[],
): Promise<void> {
  const outcome = context.writer.labelVoices
    ? await context.writer.labelVoices(raw).catch(() => null)
    : null;
  context.repository.saveVoices(recordingId, voicesHash(raw), outcome?.labels ?? null);
}

/** «Подтвердить голоса»: `false` — делить ещё нечего. */
export function confirmDebriefVoices(
  context: DebriefContext,
  subject: DebriefSubject,
  candidate: VoiceId,
): boolean {
  const state = recordingState(context, subject);
  if (!state || state.voices?.status !== 'ready') return false;
  return context.repository.setCandidateVoice(state.recording.id, candidate);
}
