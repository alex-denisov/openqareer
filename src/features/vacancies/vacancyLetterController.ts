import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovedVacancyLetterResult,
  CandidateWorkplaceForLetter,
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCircleResult,
} from './vacancyLetterApi';
import { getVacancyConnectionCircles } from './vacancyLetterApi';
import { useLetterApproval } from './vacancyLetterApproval';
import type { ResumeSnapshotFailure } from './vacancyLetterResumeNote';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import { requestVacancyPitch } from './vacancyPitchApi';
import { letterBodyForCircle, recipientForConnectionPath } from './vacancyLetterModel';

type PitchTone = NonNullable<VacancyPitchPayload['tone']>;
type PitchLanguage = NonNullable<VacancyPitchPayload['language']>;

interface ConnectionCirclesState {
  readonly data: Awaited<ReturnType<typeof getVacancyConnectionCircles>> | null;
  readonly loading: boolean;
  readonly error: string;
  readonly retry: () => void;
}

interface CircleSelection {
  readonly circle: ConnectionCircleNumber;
  readonly setCircle: (circle: ConnectionCircleNumber) => void;
  readonly selectedPathId: string | null;
  readonly setSelectedPathId: (id: string | null) => void;
  readonly selectedPath?: ConnectionCirclePath;
  readonly result?: ConnectionCircleResult;
}

export interface LetterDraftState {
  readonly pitch: VacancyPitchResult | null;
  readonly workplaces: readonly CandidateWorkplaceForLetter[];
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly loading: boolean;
  readonly error: string;
  readonly retry: () => void;
}

export interface ApprovalState {
  readonly saved: ApprovedVacancyLetterResult | null;
  readonly busy: boolean;
  readonly error: string;
  readonly approve: () => Promise<void>;
  readonly reset: () => void;
  /** Снимок резюме не создался: письмо не одобряется, пока резюме не готово (B601, 08.11). */
  readonly resumeFailure: ResumeSnapshotFailure | null;
  readonly prepareResume: () => Promise<void>;
  readonly attachGeneralResume: () => Promise<void>;
}

export interface LetterScreenState {
  readonly circles: ConnectionCirclesState;
  readonly circle: CircleSelection;
  readonly tone: PitchTone;
  readonly language: 'auto' | PitchLanguage;
  readonly setTone: (tone: PitchTone) => void;
  readonly setLanguage: (language: 'auto' | PitchLanguage) => void;
  readonly draft: LetterDraftState;
  readonly approval: ApprovalState;
}

function useConnectionCircles(vacancyId: string): ConnectionCirclesState {
  const [data, setData] = useState<Awaited<ReturnType<typeof getVacancyConnectionCircles>> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getVacancyConnectionCircles(vacancyId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить пути.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retryKey, vacancyId]);
  const retry = useCallback(() => setRetryKey((current) => current + 1), []);
  return { data, loading, error, retry };
}

function useCircleSelection(
  circles: readonly ConnectionCircleResult[],
  initialCircle?: ConnectionCircleNumber,
): CircleSelection {
  const [circle, setCircle] = useState<ConnectionCircleNumber>(initialCircle ?? 1);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const result = circles.find((item) => item.circle === circle);
  const selectedPath = result?.paths.find((path) => path.id === selectedPathId) ?? result?.paths[0];
  return { circle, setCircle, selectedPathId, setSelectedPathId, selectedPath, result };
}

function beginLetterPitchRequest(input: {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly tone: PitchTone;
  readonly language: 'auto' | PitchLanguage;
  readonly recipient?: VacancyPitchPayload['recipient'];
  readonly requestSequence: { current: number };
  readonly setPitch: (pitch: VacancyPitchResult | null) => void;
  readonly setWorkplaces: (workplaces: readonly CandidateWorkplaceForLetter[]) => void;
  readonly setText: (text: string) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string) => void;
}): () => void {
  let active = true;
  const sequence = input.requestSequence.current + 1;
  input.requestSequence.current = sequence;
  input.setLoading(true);
  input.setError('');
  input.setPitch(null);
  const payload: VacancyPitchPayload = {
    tone: input.tone,
    ...(input.language === 'auto' ? {} : { language: input.language }),
    ...(input.recipient ? { recipient: input.recipient } : {}),
  };
  void requestVacancyPitch(input.vacancyId, payload)
    .then((result) => {
      if (!active || input.requestSequence.current !== sequence) return;
      input.setPitch(result);
      input.setWorkplaces(result.candidateWorkplaces ?? []);
      input.setText(letterBodyForCircle(input.circle, result));
    })
    .catch((reason: unknown) => {
      if (active && input.requestSequence.current === sequence) {
        input.setError(reason instanceof Error ? reason.message : 'Не удалось подготовить письмо.');
      }
    })
    .finally(() => {
      if (active && input.requestSequence.current === sequence) input.setLoading(false);
    });
  return () => {
    active = false;
  };
}

interface PitchRequestState {
  readonly pitch: VacancyPitchResult | null;
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly loading: boolean;
  readonly error: string;
  readonly retry: () => void;
}

interface PitchRequestInput {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly requestKey: number;
  readonly path?: ConnectionCirclePath;
  readonly tone: PitchTone;
  readonly language: 'auto' | PitchLanguage;
  readonly enabled: boolean;
  readonly resetWhenDisabled: boolean;
  readonly setWorkplaces: (workplaces: readonly CandidateWorkplaceForLetter[]) => void;
  readonly setPitch: (pitch: VacancyPitchResult | null) => void;
  readonly setText: (text: string) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string) => void;
}

function runPitchRequestEffect(
  input: PitchRequestInput,
  recipient: VacancyPitchPayload['recipient'] | undefined,
  requestSequence: { current: number },
) {
  if (!input.enabled) {
    if (input.resetWhenDisabled) clearDisabledPitch(input);
    input.setLoading(false);
    return undefined;
  }
  return beginLetterPitchRequest({
    vacancyId: input.vacancyId,
    circle: input.circle,
    tone: input.tone,
    language: input.language,
    recipient,
    requestSequence,
    setPitch: input.setPitch,
    setWorkplaces: input.setWorkplaces,
    setText: input.setText,
    setLoading: input.setLoading,
    setError: input.setError,
  });
}

function clearDisabledPitch(input: PitchRequestInput) {
  input.setPitch(null);
  input.setWorkplaces([]);
  input.setText('');
  input.setError('');
}

function usePitchRequestEffect(input: PitchRequestInput): void {
  const recipient = useMemo(
    () => (input.path ? recipientForConnectionPath(input.path) : undefined),
    [input.path],
  );
  const requestSequence = useRef(0);
  useEffect(
    () => runPitchRequestEffect(input, recipient, requestSequence),
    [input, recipient],
  );
}

type PitchGenerationInput = Omit<
  PitchRequestInput,
  'requestKey' | 'setPitch' | 'setText' | 'setLoading' | 'setError'
>;

function usePitchGeneration(input: PitchGenerationInput): PitchRequestState {
  const [pitch, setPitch] = useState<VacancyPitchResult | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const requestInput = useMemo(
    () => ({
      ...input,
      requestKey: retryKey,
      setPitch,
      setText,
      setLoading,
      setError,
    }),
    [
      input.vacancyId,
      input.circle,
      input.path,
      input.tone,
      input.language,
      input.enabled,
      input.resetWhenDisabled,
      input.setWorkplaces,
      retryKey,
    ],
  );
  usePitchRequestEffect(requestInput);
  const retry = useCallback(() => setRetryKey((current) => current + 1), []);
  return { pitch, text, setText, loading, error, retry };
}

function useLetterDraft({
  vacancyId,
  circle,
  path,
  tone,
  language,
  enabled,
  resetWhenDisabled,
}: {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly path?: ConnectionCirclePath;
  readonly tone: PitchTone;
  readonly language: 'auto' | PitchLanguage;
  readonly enabled: boolean;
  readonly resetWhenDisabled: boolean;
}): LetterDraftState {
  const [workplaces, setWorkplaces] = useState<readonly CandidateWorkplaceForLetter[]>([]);
  const pitchState = usePitchGeneration({
    vacancyId,
    circle,
    path,
    tone,
    language,
    enabled,
    resetWhenDisabled,
    setWorkplaces,
  });
  return { ...pitchState, workplaces };
}

export function useVacancyLetterController(
  vacancyId: string,
  initialCircle?: ConnectionCircleNumber,
): LetterScreenState {
  const circles = useConnectionCircles(vacancyId);
  const circle = useCircleSelection(circles.data?.circles ?? [], initialCircle);
  const [tone, setTone] = useState<PitchTone>('executive');
  const [language, setLanguage] = useState<'auto' | PitchLanguage>('auto');
  const draft = useLetterDraft({
    vacancyId,
    circle: circle.circle,
    path: circle.selectedPath,
    tone,
    language,
    enabled:
      Boolean(circles.data) &&
      !circles.loading &&
      !circles.error &&
      (circle.circle === 3 || Boolean(circle.selectedPath)),
    resetWhenDisabled:
      Boolean(circles.data) &&
      !circles.loading &&
      !circles.error &&
      circle.circle !== 3 &&
      !circle.selectedPath,
  });
  const approval = useLetterApproval({
    vacancyId,
    circle: circle.circle,
    language,
    tone,
    path: circle.selectedPath,
    pitch: draft.pitch,
    body: draft.text,
    // B618: выбора нет, письмо опирается на все места работы профиля.
    includedWorkplaceIds: draft.workplaces.map((workplace) => workplace.id),
    onResumeChanged: draft.retry,
  });
  return { circles, circle, tone, language, setTone, setLanguage, draft, approval };
}
