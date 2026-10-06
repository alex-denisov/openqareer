import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  executeCandidateActionBatch,
  getActionsOnBehalfConsent,
  getCandidateActionUsage,
  grantActionsOnBehalfConsent,
  listCandidateActionReceipts,
  setCandidateActionKillSwitch,
  type CandidateActionInput,
  type CandidateActionReceiptView,
  type CandidateActionUsageView,
} from './applicationsApi';
import type { ApplicationView } from './applicationsApi';
import { CoachApiError } from '../coach/apiClient';
import { CAPABILITY_CONSENTS_APPROVED, CAPABILITY_CONSENT_CURRENT_VERSION } from '../legal/capabilityConsents';
import { formatActionCount, getActionLimitMessage, getSelectableActionApplications } from './candidateActionModel';

interface SubmitActionBatchInput {
  readonly data: ReturnType<typeof useActionPanelData>;
  readonly selection: ReturnType<typeof useActionSelection>;
  readonly consentGranted: boolean;
  readonly onRefreshApplications?: () => void | Promise<unknown>;
  readonly busy: boolean;
  readonly setBusy: (value: boolean) => void;
  readonly setActiveBatchId: (value: string | null) => void;
  readonly setLiveReceipts: (value: readonly CandidateActionReceiptView[]) => void;
  readonly setActionError: (value: string) => void;
  readonly setRunnerNotConnected: (value: boolean) => void;
  readonly setNotice: (value: string) => void;
}

export function useCandidateActionPanel(
  applications: readonly ApplicationView[],
  onRefreshApplications?: () => void | Promise<unknown>,
) {
  const selectableApplications = useMemo(() => getSelectableActionApplications(applications), [applications]);
  const data = useActionPanelData();
  const selection = useActionSelection(selectableApplications, data.usage);
  const consent = useActionConsent(data.consentGranted);
  const operations = useActionSubmission({
    data,
    selection,
    consentGranted: data.consentGranted,
    onRefreshApplications,
  });
  const toggleKillSwitch = useActionKillSwitch(data.usage, data.setUsage, operations.setActionError, operations.setNotice);
  return {
    ...data,
    ...selection,
    ...consent,
    ...operations,
    consentCanBeGiven: CAPABILITY_CONSENTS_APPROVED,
    toggleKillSwitch,
  };
}

function useActionPanelData() {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<CandidateActionUsageView>();
  const [receipts, setReceipts] = useState<readonly CandidateActionReceiptView[]>([]);
  const [consentGranted, setConsentGranted] = useState(false);
  const [loadError, setLoadError] = useState('');
  const reload = useCallback(async (signal?: AbortSignal) => {
    const [nextUsage, nextReceipts, nextConsent] = await Promise.all([
      getCandidateActionUsage(signal),
      listCandidateActionReceipts({ limit: 20, signal }),
      getActionsOnBehalfConsent(signal),
    ]);
    setUsage(nextUsage);
    setReceipts(nextReceipts);
    setConsentGranted(nextConsent.granted);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal)
      .catch((error: unknown) => setLoadError(errorMessage(error)))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reload]);
  return { loading, usage, setUsage, receipts, setReceipts, consentGranted, setConsentGranted, loadError, reload };
}

function useActionSelection(
  selectableApplications: ReturnType<typeof getSelectableActionApplications>,
  usage?: CandidateActionUsageView,
) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [letters, setLetters] = useState<ReadonlyMap<string, string>>(new Map());
  const [includeResumeBoost, setIncludeResumeBoost] = useState(false);
  const [confirmedByCandidate, setConfirmedByCandidate] = useState(false);
  useEffect(() => {
    const availableIds = new Set(selectableApplications.map((item) => item.application.id));
    if (![...selectedIds].some((id) => !availableIds.has(id))) return;
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
    setConfirmedByCandidate(false);
  }, [selectableApplications, selectedIds]);
  const selection = deriveSelection(selectableApplications, selectedIds, letters, includeResumeBoost, usage);
  const toggleApplication = useCallback((applicationId: string, selected: boolean) => {
    setConfirmedByCandidate(false);
    setSelectedIds((current) => toggleSetValue(current, applicationId, selected));
  }, []);
  const setLetter = useCallback((applicationId: string, value: string) => {
    setConfirmedByCandidate(false);
    setLetters((current) => new Map(current).set(applicationId, value));
  }, []);
  const toggleResumeBoost = useCallback((selected: boolean) => {
    setConfirmedByCandidate(false);
    setIncludeResumeBoost(selected);
  }, []);
  return {
    ...selection,
    selectedIds,
    letters,
    toggleApplication,
    setLetter,
    includeResumeBoost,
    setIncludeResumeBoost: toggleResumeBoost,
    confirmedByCandidate,
    setConfirmedByCandidate,
  };
}

function deriveSelection(
  selectable: ReturnType<typeof getSelectableActionApplications>,
  selectedIds: ReadonlySet<string>,
  letters: ReadonlyMap<string, string>,
  includeResumeBoost: boolean,
  usage?: CandidateActionUsageView,
) {
  const selectedApplications = selectable.filter((item) => selectedIds.has(item.application.id));
  const selectedKinds = selectedApplications.map((item) => ({ actionKind: item.actionKind }));
  if (includeResumeBoost) selectedKinds.push({ actionKind: 'hh_resume_boost' });
  const limitMessage = usage
    ? getActionLimitMessage({
        actions: selectedKinds,
        usage: usage.usage,
        timezone: usage.timezone,
        now: new Date(),
        resetAt: usage.resetAt,
      })
    : null;
  return {
    selectableApplications: selectable,
    selectedApplications,
    selectedCount: selectedKinds.length,
    letterMissing: selectedApplications.some(
      (item) => item.platform === 'hh' && !letters.get(item.application.id)?.trim(),
    ),
    limitMessage,
  };
}

function useActionConsent(consentGranted: boolean) {
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState('');
  const grantConsent = useCallback(async () => {
    if (!CAPABILITY_CONSENTS_APPROVED || !consentAccepted || consentGranted) return;
    setConsentBusy(true);
    setConsentError('');
    try {
      await grantActionsOnBehalfConsent(CAPABILITY_CONSENT_CURRENT_VERSION.actions_on_behalf);
      setConsentAccepted(false);
    } catch (error) {
      setConsentError(errorMessage(error));
    } finally {
      setConsentBusy(false);
    }
  }, [consentAccepted, consentGranted]);
  return { consentAccepted, setConsentAccepted, consentBusy, consentError, grantConsent };
}

function useActionSubmission(input: {
  data: ReturnType<typeof useActionPanelData>;
  selection: ReturnType<typeof useActionSelection>;
  consentGranted: boolean;
  onRefreshApplications?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [liveReceipts, setLiveReceipts] = useState<readonly CandidateActionReceiptView[]>([]);
  const [actionError, setActionError] = useState('');
  const [runnerNotConnected, setRunnerNotConnected] = useState(false);
  const [notice, setNotice] = useState('');
  useActionProgress(activeBatchId, setLiveReceipts);
  const submit = useCallback(async () => {
    await submitActionBatch({ ...input, busy, setBusy, setActiveBatchId, setLiveReceipts, setActionError, setRunnerNotConnected, setNotice });
  }, [input, busy]);
  return { busy, liveReceipts, actionError, setActionError, runnerNotConnected, notice, setNotice, submit };
}

async function submitActionBatch(input: SubmitActionBatchInput): Promise<void> {
  const { data, selection } = input;
  if (!data.usage || !input.consentGranted || !selection.confirmedByCandidate || input.busy) return;
  if (!selection.selectedCount) return;
  if (selection.letterMissing) return input.setActionError('Добавьте текст письма для каждого отклика на hh.ru.');
  if (selection.limitMessage) return input.setActionError(selection.limitMessage);
  const batchId = createUuid();
  const actions = buildActions(selection.selectedApplications, selection.letters, selection.includeResumeBoost);
  input.setBusy(true);
  input.setActionError('');
  input.setNotice('');
  input.setActiveBatchId(batchId);
  input.setLiveReceipts([]);
  try {
    const result = await executeCandidateActionBatch({ batchId, confirmedByCandidate: true, actions });
    data.setReceipts(result.receipts);
    input.setLiveReceipts(result.receipts);
    input.setNotice(batchResultCopy(result.status, result.receipts));
    if (result.receipts.some((receipt) => receipt.status === 'delivered')) {
      await Promise.resolve(input.onRefreshApplications?.()).catch(() => undefined);
    }
    await data.reload().catch(() => undefined);
  } catch (error) {
    if (error instanceof CoachApiError && error.code === 'runner_not_connected') {
      input.setRunnerNotConnected(true);
    }
    input.setActionError(errorMessage(error));
    await data.reload().catch(() => undefined);
  } finally {
    input.setActiveBatchId(null);
    input.setBusy(false);
  }
}

function useActionProgress(
  batchId: string | null,
  setReceipts: (value: readonly CandidateActionReceiptView[]) => void,
): void {
  useEffect(() => {
    if (!batchId) return undefined;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        const current = await listCandidateActionReceipts({ batchId, limit: 100 });
        if (!stopped && current.length > 0) setReceipts(current);
      } catch {
        // A lost progress poll does not change the final batch response.
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 700);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [batchId, setReceipts]);
}

function useActionKillSwitch(
  usage: CandidateActionUsageView | undefined,
  setUsage: (value: CandidateActionUsageView) => void,
  setError: (value: string) => void,
  setNotice: (value: string) => void,
) {
  return useCallback(async () => {
    if (!usage) return;
    const nextActive = !usage.killSwitchActive;
    setError('');
    try {
      await setCandidateActionKillSwitch(nextActive);
      const refreshed = await getCandidateActionUsage();
      setUsage(refreshed);
      setNotice(killSwitchNotice(nextActive, refreshed.killSwitchActive));
    } catch (error) {
      setError(errorMessage(error));
    }
  }, [usage, setError, setNotice, setUsage]);
}

function toggleSetValue(current: ReadonlySet<string>, value: string, selected: boolean): ReadonlySet<string> {
  const next = new Set(current);
  if (selected) next.add(value);
  else next.delete(value);
  return next;
}

function killSwitchNotice(requestedActive: boolean, effectiveActive: boolean): string {
  if (requestedActive) return 'Остановка включена. Текущее действие завершится, следующие не начнутся.';
  if (effectiveActive) return 'Остановка площадки действует. Новые действия не начнутся.';
  return 'Остановка снята. Новый пакет можно запустить после проверки.';
}

function buildActions(
  selectedApplications: ReturnType<typeof getSelectableActionApplications>,
  letters: ReadonlyMap<string, string>,
  includeResumeBoost: boolean,
): CandidateActionInput[] {
  const actions: CandidateActionInput[] = selectedApplications.map((item) => ({
    id: createUuid(),
    platform: item.platform,
    actionKind: item.actionKind,
    applicationId: item.application.id,
    targetUrl: item.targetUrl,
    ...(letters.get(item.application.id)?.trim()
      ? { letterText: letters.get(item.application.id)?.trim() }
      : {}),
  }));
  if (includeResumeBoost) actions.push({
    id: createUuid(),
    platform: 'hh',
    actionKind: 'hh_resume_boost',
    targetUrl: 'https://hh.ru/applicant/resumes',
  });
  return actions;
}

function batchResultCopy(
  status: 'completed' | 'partial_failure' | 'aborted',
  receipts: readonly CandidateActionReceiptView[],
): string {
  const delivered = receipts.filter((receipt) => receipt.status === 'delivered').length;
  if (status === 'completed') return `Площадка подтвердила ${formatActionCount(delivered)}.`;
  if (status === 'partial_failure') return `Площадка подтвердила ${formatActionCount(delivered)}. Пакет остановлен после сбоя.`;
  return 'Пакет остановлен. Проверьте причины в квитанциях ниже.';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось выполнить запрос. Проверьте соединение и повторите.';
}

function createUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
