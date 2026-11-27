import { useId, useState } from 'react';
import type { HhResumeSummary } from '../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../coach/apiClient';
import { StatusLine, useToast } from '../kit';

interface HhResumeSelectProps {
  readonly resumes: readonly HhResumeSummary[];
  readonly selectedId: string | null;
  /** Страница выбранного резюме читается в окне hh.ru. */
  readonly reading: boolean;
  readonly onPick: (resumeId: string) => Promise<void>;
}

/** «Резюме hh.ru» (макет o03): каким резюме уйдёт отклик на hh.ru. */
export function HhResumeSelect({ resumes, selectedId, reading, onPick }: HhResumeSelectProps) {
  const id = useId();
  const toast = useToast();
  // Выбранное видно сразу, пока выбор сохраняется; сбой возвращает прежнее.
  const [picked, setPicked] = useState<string | null>(null);
  const busy = picked !== null || reading;
  const change = async (resumeId: string) => {
    setPicked(resumeId);
    try {
      await onPick(resumeId);
    } catch (reason) {
      toast.show({ text: apiErrorMessage(reason, 'Резюме hh.ru не выбралось. Повторите.') });
    } finally {
      setPicked(null);
    }
  };
  const value = picked ?? selectedId ?? '';
  return (
    <div className="cv-hh">
      <label className="cv-hh-l" htmlFor={id}>
        Резюме hh.ru
      </label>
      <select
        id={id}
        value={value}
        aria-busy={busy}
        disabled={busy}
        onChange={(event) => void change(event.currentTarget.value)}
      >
        {value ? null : (
          <option value="" disabled>
            Не выбрано
          </option>
        )}
        {resumes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      {reading ? <StatusLine state="wait" text="Читаем резюме в hh.ru" /> : null}
    </div>
  );
}
