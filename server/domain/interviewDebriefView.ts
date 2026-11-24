import type { DebriefFindings, DebriefLine, DebriefMetrics } from './interviewDebrief';
import type { VoiceId, VoiceSummaryItem } from './interviewVoices';

/**
 * B751: ответ `GET /applications/:id/interviews/:iid/debrief` для экранов I4, I4b, I4c.
 * Запись — последняя по интервью; аудио на сервере нет, только расшифровка.
 */
export type DebriefRecordingStatus = 'recording' | 'transcribing' | 'ready' | 'failed';

export interface DebriefRecordingView {
  readonly id: string;
  readonly status: DebriefRecordingStatus;
  /** `app` — запись .app по двум каналам; `upload` — файл, голоса делятся на шаге «Чей голос». */
  readonly source: 'app' | 'upload';
  readonly startedAt: string;
  /** Сколько сегментов не расшифровалось: разбор строится по остальным. */
  readonly gaps: number;
}

/** Модель: `ready` — разбор есть; `failed` — показать «Повторить разбор»; `none` — ещё не звали. */
export type DebriefAnalysis =
  | { readonly status: 'ready'; readonly findings: DebriefFindings; readonly answeredBy: string }
  | { readonly status: 'failed' }
  | { readonly status: 'none' };

/**
 * B642, I4c «Чей голос»: только у загруженного файла. `none` — деления ещё нет,
 * `failed` — модель не разделила; `candidate` — голос, который кандидат отметил своим.
 */
export interface DebriefVoicesView {
  readonly status: 'none' | 'ready' | 'failed';
  readonly candidate: VoiceId | null;
  readonly items: readonly VoiceSummaryItem[];
}

export interface InterviewDebriefView {
  readonly interviewId: string;
  readonly scheduledAt: string | null;
  readonly format: string | null;
  /** Имя собеседника, которое кандидат указал при загрузке файла. */
  readonly interviewerName: string | null;
  readonly recording: DebriefRecordingView | null;
  readonly transcript: readonly DebriefLine[];
  /** Голоса загруженного файла; `null` — запись .app (голоса по дорожкам) или записи нет. */
  readonly voices: DebriefVoicesView | null;
  readonly metrics: DebriefMetrics | null;
  readonly analysis: DebriefAnalysis;
  /** «Ваши заметки» — поле debrief интервью. */
  readonly notes: string | null;
}
