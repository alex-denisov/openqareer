import { useCallback, useId, useState } from 'react';
import type { HhResumeSnapshot, HhResumeSummary } from '../../../../shared/hhCandidateSession';
import { apiErrorMessage } from '../../coach/apiClient';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { useToast } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { readHhResumeContent } from './hh/hhDesktop';
import { getHhResumes, saveHhResumes } from './hh/hhSessionApi';

function knownContent(snapshot: HhResumeSnapshot, id: string) {
  if (snapshot.selected?.id === id) return snapshot.selected;
  return snapshot.contents?.find((item) => item.id === id) ?? null;
}

async function select(snapshot: HhResumeSnapshot, item: HhResumeSummary) {
  const known = knownContent(snapshot, item.id);
  if (known) return saveHhResumes(snapshot.resumes, known, undefined, false);
  const content = await readHhResumeContent({
    id: item.id,
    title: item.title,
    url: `https://hh.ru/resume/${item.id}`,
  });
  return saveHhResumes(snapshot.resumes, content);
}

/** «Резюме hh.ru» (макет o03): каким резюме уйдёт отклик на hh.ru. */
export function HhResumeSelect() {
  const id = useId();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const load = useCallback((signal: AbortSignal) => getHhResumes(signal), []);
  const { state, replaceData } = useAsync(load, '');
  const snapshot = state.data;
  if (!snapshot || snapshot.resumes.length === 0) return null;
  const change = async (resumeId: string) => {
    const item = snapshot.resumes.find((resume) => resume.id === resumeId);
    if (!item) return;
    setBusy(true);
    try {
      replaceData(await select(snapshot, item));
    } catch (reason) {
      toast.show({ text: apiErrorMessage(reason, 'Резюме hh.ru не прочиталось. Повторите.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cv-hh">
      <label className="cv-hh-l" htmlFor={id}>
        Резюме hh.ru
      </label>
      <select
        id={id}
        value={snapshot.selected?.id ?? ''}
        disabled={busy}
        onChange={(event) => void change(event.currentTarget.value)}
      >
        {snapshot.selected ? null : (
          <option value="" disabled>
            Не выбрано
          </option>
        )}
        {snapshot.resumes.map((item) => (
          <option
            key={item.id}
            value={item.id}
            disabled={!isTauriEnvironment() && !knownContent(snapshot, item.id)}
          >
            {item.title}
          </option>
        ))}
      </select>
    </div>
  );
}
