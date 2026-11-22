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
import { buildRecordingView } from './recordingView';

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

const findingsData = (recordingId: string, hash: string) => `${recordingId}:debrief:${hash}`;
const interviewerData = (interviewId: string) => `${interviewId}:interviewer`;

interface RecordingState {
  readonly recording: StoredRecording;
  readonly view: ReturnType<typeof buildRecordingView>;
}

function recordingState(context: DebriefContext, subject: DebriefSubject): RecordingState | null {
  const { repository, sealedText } = context;
  const recording = repository.latestForInterview(subject.candidateId, subject.interview.id);
  if (!recording) return null;
  const view = buildRecordingView(sealedText, recording, repository.listSegments(recording.id));
  return { recording, view };
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
          source: state.recording.source,
          startedAt: state.view.segments[0]?.startedAt ?? state.recording.createdAt,
          gaps: state.view.gaps.length,
        }
      : null,
    transcript,
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
  const state = recordingState(context, subject);
  const lines = state?.view.transcript ?? [];
  if (!state || lines.length === 0) return buildDebriefView(context, subject);
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
