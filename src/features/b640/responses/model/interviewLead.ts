import type { InterviewDebriefView } from '../../../../../server/domain/interviewDebriefView';
import { durationText } from '../../interview/model/debriefModel';

type RecordingFacts = Pick<InterviewDebriefView, 'recording' | 'metrics'>;

const SOURCE: Readonly<Record<'app' | 'upload', string>> = {
  app: 'из приложения',
  upload: 'из файла',
};

/**
 * Вторая фраза «Что дальше» после интервью (макет o01c): «Запись из приложения есть, 58 минут.»
 * Фразы нет, пока записи нет или её длина ещё не известна.
 */
export function recordingLine(debrief: RecordingFacts | null): string | null {
  const recording = debrief?.recording;
  const durationMs = debrief?.metrics?.durationMs;
  if (!recording || recording.status !== 'ready' || !durationMs) return null;
  return `Запись ${SOURCE[recording.source]} есть, ${durationText(durationMs)}.`;
}
