import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApprovedVacancyLetterInput,
  ApprovedVacancyLetterResult,
  CandidateWorkplaceForLetter,
  ConnectionCircleNumber,
  ConnectionCirclePath,
  ConnectionCircleResult,
} from './vacancyLetterApi';
import { approveVacancyLetter, getVacancyConnectionCircles } from './vacancyLetterApi';
import type { VacancyPitchPayload, VacancyPitchResult } from './vacancyPitchApi';
import { requestVacancyPitch } from './vacancyPitchApi';
import {
  excludedEvidenceIdsForWorkplaces,
  letterBodyForCircle,
  personAddressedByConnectionPath,
  recipientForConnectionPath,
} from './vacancyLetterModel';

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

interface WorkplaceSelection {
  readonly includedIds: readonly string[];
  readonly excludedEvidenceIds: readonly string[];
  readonly toggle: (workplaceId: string) => void;
}

export interface LetterDraftState extends WorkplaceSelection {
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

function useWorkplaceSelection(
  workplaces: readonly CandidateWorkplaceForLetter[],
): WorkplaceSelection {
  const [override, setOverride] = useState<readonly string[] | null>(null);
  const availableIds = useMemo(
    () =>
      workplaces
        .filter((workplace) => workplace.evidenceIds.length > 0)
        .map((workplace) => workplace.id),
    [workplaces],
  );
  const includedIds = override ?? availableIds;
  const excludedEvidenceIds = useMemo(
    () => excludedEvidenceIdsForWorkplaces(workplaces, includedIds),
    [includedIds, workplaces],
  );
  const toggle = useCallback(
    (workplaceId: string) => {
      setOverride((current) => {
        const next = new Set(current ?? availableIds);
        if (next.has(workplaceId)) next.delete(workplaceId);
        else next.add(workplaceId);
        return Array.from(next);
      });
    },
    [availableIds],
  );
  return { includedIds, excludedEvidenceIds, toggle };
}

function beginLetterPitchRequest(input: {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly tone: PitchTone;
  readonly language: 'auto' | PitchLanguage;
  readonly recipient?: VacancyPitchPayload['recipient'];
  readonly excludedEvidenceIds: readonly string[];
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
    excludedEvidenceIds: input.excludedEvidenceIds,
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
  readonly excludedEvidenceIds: readonly string[];
  readonly setWorkplaces: (workplaces: readonly CandidateWorkplaceForLetter[]) => void;
  readonly setPitch: (pitch: VacancyPitchResult | null) => void;
  readonly setText: (text: string) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly setError: (error: string) => void;
}

function runPitchRequestEffect(
  input: PitchRequestInput,
  recipient: VacancyPitchPayload['recipient'] | undefined,
  excludedKey: string,
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
    excludedEvidenceIds: JSON.parse(excludedKey) as string[],
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
  const excludedKey = JSON.stringify(input.excludedEvidenceIds);
  useEffect(
    () => runPitchRequestEffect(input, recipient, excludedKey, requestSequence),
    [input, recipient, excludedKey],
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
  const excludedEvidenceKey = JSON.stringify(input.excludedEvidenceIds);
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
      excludedEvidenceKey,
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
  const selection = useWorkplaceSelection(workplaces);
  const pitchState = usePitchGeneration({
    vacancyId,
    circle,
    path,
    tone,
    language,
    enabled,
    resetWhenDisabled,
    excludedEvidenceIds: selection.excludedEvidenceIds,
    setWorkplaces,
  });
  return { ...pitchState, workplaces, ...selection };
}

function approvedSnapshot(
  input: {
    readonly circle: ConnectionCircleNumber;
    readonly language: 'auto' | PitchLanguage;
    readonly tone: PitchTone;
    readonly path?: ConnectionCirclePath;
    readonly pitch: VacancyPitchResult;
    readonly body: string;
    readonly includedWorkplaceIds: readonly string[];
  },
  language: PitchLanguage,
): ApprovedVacancyLetterInput {
  const recipient = input.path ? personAddressedByConnectionPath(input.path) : undefined;
  return {
    circle: input.circle,
    language,
    tone: input.tone,
    ...(recipient
      ? {
          recipient: {
            id: recipient.id,
            name: recipient.fullName,
            ...(recipient.roleTitle ? { role: recipient.roleTitle } : {}),
            ...(recipient.companyName ? { company: recipient.companyName } : {}),
          },
        }
      : {}),
    ...(input.pitch.emailPitch.subject ? { subject: input.pitch.emailPitch.subject } : {}),
    body: input.body.trim(),
    usedEvidenceIds: input.pitch.usedEvidenceIds,
    includedWorkplaceIds: input.includedWorkplaceIds,
  };
}

function useLetterApproval(input: {
  readonly vacancyId: string;
  readonly circle: ConnectionCircleNumber;
  readonly language: 'auto' | PitchLanguage;
  readonly tone: PitchTone;
  readonly path?: ConnectionCirclePath;
  readonly pitch: VacancyPitchResult | null;
  readonly body: string;
  readonly includedWorkplaceIds: readonly string[];
}): ApprovalState {
  const [saved, setSaved] = useState<ApprovedVacancyLetterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reset = useCallback(() => {
    setSaved(null);
    setError('');
  }, []);
  const approve = useCallback(async () => {
    if (busy || !input.pitch || !input.body.trim()) return;
    const pitch = input.pitch;
    const language = pitch.language ?? (input.language === 'auto' ? undefined : input.language);
    if (!language) {
      setError('Не удалось определить язык письма. Выберите его вручную.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setSaved(
        await approveVacancyLetter(
          input.vacancyId,
          approvedSnapshot({ ...input, pitch }, language),
        ),
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить снимок письма.');
    } finally {
      setBusy(false);
    }
  }, [busy, input]);
  return { saved, busy, error, approve, reset };
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
    includedWorkplaceIds: draft.includedIds,
  });
  return { circles, circle, tone, language, setTone, setLanguage, draft, approval };
}
