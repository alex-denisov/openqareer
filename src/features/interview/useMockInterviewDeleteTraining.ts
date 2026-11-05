import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { deleteInterviewSession } from './interviewSimulatorApi';
import type { MockInterviewScreen } from './mockInterviewControllerTypes';
import { toInterviewUiError } from './mockInterviewSessionUtils';
import type { MockInterviewSessionState } from './useMockInterviewSession';
import type { SpeechTranscription } from './useSpeechTranscription';

interface DeleteTrainingOptions {
  readonly model: MockInterviewSessionState;
  readonly speech: SpeechTranscription;
  readonly setDraft: Dispatch<SetStateAction<string>>;
  readonly setScreen: Dispatch<SetStateAction<MockInterviewScreen>>;
}

export interface MockInterviewDeleteTraining {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => Promise<void>;
}

/** Тренировка, удалённая на другом устройстве, для этого экрана тоже удалена. */
export function useMockInterviewDeleteTraining({
  model,
  speech,
  setDraft,
  setScreen,
}: DeleteTrainingOptions): MockInterviewDeleteTraining {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);
  const cancel = useCallback(() => setOpen(false), []);
  const sessionId = model.session?.id;
  const confirm = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInterviewSession(sessionId);
    } catch (reason) {
      const failure = toInterviewUiError(
        reason,
        'Не удалось удалить тренировку. Попробуйте ещё раз.',
      );
      if (failure.code !== 'interview_session_not_found') {
        setError(failure.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setOpen(false);
    model.forgetSession();
    speech.reset();
    setDraft('');
    setScreen('setup');
  };
  return { open, busy, error, ask, cancel, confirm };
}
