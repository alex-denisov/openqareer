import { useEffect, useState } from 'react';
import { loadInterviewDebrief } from '../interview/data/debriefApi';
import { recordingLine } from './model/interviewLead';

/**
 * «Запись из приложения есть, 58 минут.» под вопросом «Как прошло интервью…» (макет o01c).
 * Читается только после интервью; сбой чтения оставляет одну первую фразу — разбор и загрузка
 * файла доступны кнопками рядом, а причина сбоя видна на самом экране разбора.
 */
export function useRecordingLine(applicationId: string, enabled: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    loadInterviewDebrief(applicationId, controller.signal)
      .then((debrief) => setLine(recordingLine(debrief)))
      .catch(() => setLine(null));
    return () => controller.abort();
  }, [applicationId, enabled]);
  return enabled ? line : null;
}
