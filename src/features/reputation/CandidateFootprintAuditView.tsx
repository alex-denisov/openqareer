import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CandidateFootprintAudit,
  CandidateFootprintConsentState,
  FootprintAdapterId,
  FootprintReview,
} from '../../../shared/candidateFootprint';
import type { PublicFootprintQueryPlanItem } from '../../../server/osint/candidateFootprintQueryPlan';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../legal/capabilityConsents';
import {
  deleteCandidateFootprintFindings,
  getCandidateFootprintAudit,
  getCandidateFootprintPlan,
  grantCandidateFootprintConsent,
  reviewCandidateFootprintFinding,
  revokeCandidateFootprintConsent,
  startCandidateFootprintAudit,
} from './candidateFootprintApi';
import { CandidateFootprintAuditSurface } from './CandidateFootprintAuditSurface';

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function defaultSelection(plan: readonly PublicFootprintQueryPlanItem[]): ReadonlySet<string> {
  return new Set(plan.filter((item) => item.selectedByDefault && item.available).map((item) => item.id));
}

const EMPTY_CONSENT: CandidateFootprintConsentState = {
  approved: false,
  granted: false,
  versionId: CAPABILITY_CONSENT_CURRENT_VERSION.digital_footprint,
};

function useFootprintOperationGeneration() {
  const operationGeneration = useRef(0);
  const get = useCallback(() => operationGeneration.current, []);
  const isCurrent = useCallback((expected: number) => operationGeneration.current === expected, []);
  const invalidate = useCallback(() => { operationGeneration.current += 1; }, []);
  return { get, isCurrent, invalidate };
}

function useCandidateFootprintPlanState(candidateId: string) {
  const [plan, setPlan] = useState<readonly PublicFootprintQueryPlanItem[]>([]);
  const [unidentifiedEmployers, setUnidentifiedEmployers] = useState<readonly string[]>([]);
  const [sourceAvailability, setSourceAvailability] = useState<Record<FootprintAdapterId, boolean>>({
    sherlock: true, maigret: true, hibp: false, wayback: true, exa: false,
  });
  const [consent, setConsent] = useState<CandidateFootprintConsentState>(EMPTY_CONSENT);
  const [audit, setAudit] = useState<CandidateFootprintAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const generation = useRef(0);
  const { get, isCurrent, invalidate } = useFootprintOperationGeneration();

  const reload = useCallback(async (manual?: readonly string[]) => {
    const current = ++generation.current;
    setLoading(true);
    setError(undefined);
    try {
      const res = await getCandidateFootprintPlan(manual);
      if (current !== generation.current) return;
      setPlan(res.plan);
      setUnidentifiedEmployers(res.unidentifiedEmployers ?? []);
      setSourceAvailability({ ...res.sourceAvailability });
      setConsent(res.consent);
      setAudit(res.audit);
    } catch (cause) {
      if (current === generation.current) setError(errorText(cause, 'Не удалось загрузить план проверки.'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { generation.current += 1; invalidate(); };
  }, [candidateId, reload, invalidate]);
  useFootprintPolling(audit?.id, audit?.state, setAudit, setError, get, isCurrent);
  return {
    plan, setPlan, unidentifiedEmployers, sourceAvailability, consent, audit, setAudit, setConsent,
    loading, error, setError, notice, setNotice, reload,
    getOperationGeneration: get, isOperationCurrent: isCurrent, invalidatePendingRequests: invalidate,
  };
}

function useManualEmployers(reload: (manual: readonly string[]) => Promise<void>) {
  const [manualEmployers, setManualEmployers] = useState<readonly string[]>([]);
  const add = useCallback(async (employer: string) => {
    const trimmed = employer.trim();
    if (!trimmed || manualEmployers.includes(trimmed)) return;
    const next = [...manualEmployers, trimmed];
    setManualEmployers(next);
    await reload(next);
  }, [manualEmployers, reload]);
  return { manualEmployers, add };
}

function useFootprintPolling(
  auditId: string | undefined,
  auditState: CandidateFootprintAudit['state'] | undefined,
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
): void {
  useEffect(() => {
    if (!auditId || auditState !== 'pending') return undefined;
    const operationGeneration = getOperationGeneration();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getCandidateFootprintAudit();
        if (!active || !isOperationCurrent(operationGeneration)) return;
        setAudit(result);
        if (result?.state === 'pending') timer = setTimeout(poll, 1_500);
      } catch (cause) {
        if (!active || !isOperationCurrent(operationGeneration)) return;
        setError(errorText(cause, 'Не удалось обновить состояние проверки.'));
        timer = setTimeout(poll, 5_000);
      }
    };
    timer = setTimeout(poll, 1_500);
    return () => { active = false; clearTimeout(timer); };
  }, [auditId, auditState, setAudit, setError, getOperationGeneration, isOperationCurrent]);
}

function useFootprintSelection(candidateId: string, plan: readonly PublicFootprintQueryPlanItem[]) {
  const [selectedQueryIds, setSelectedQueryIds] = useState<ReadonlySet<string>>(new Set());
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const initialized = useRef(false);
  const previousCandidate = useRef(candidateId);

  useEffect(() => {
    if (previousCandidate.current !== candidateId) {
      previousCandidate.current = candidateId;
      initialized.current = false;
      setSelectedQueryIds(new Set());
      setOwnershipConfirmed(false);
      return;
    }
    if (!initialized.current && plan.length) {
      setSelectedQueryIds(defaultSelection(plan));
      initialized.current = true;
      return;
    }
    if (initialized.current) {
      setSelectedQueryIds((current) =>
        new Set([...current].filter((id) => plan.some((item) => item.id === id && item.available))),
      );
    }
  }, [candidateId, plan]);

  const toggleQuery = useCallback((id: string, selected: boolean) => {
    setSelectedQueryIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
    setOwnershipConfirmed(false);
  }, []);
  return { selectedQueryIds, ownershipConfirmed, setOwnershipConfirmed, toggleQuery };
}

function useFootprintStart(
  selectedQueryIds: ReadonlySet<string>,
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  setNotice: (notice: string | undefined) => void,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
  manualEmployers?: readonly string[],
) {
  const [starting, setStarting] = useState(false);
  const selectedIds = useMemo(() => [...selectedQueryIds], [selectedQueryIds]);
  const start = useCallback(async () => {
    const operationGeneration = getOperationGeneration();
    setStarting(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const audit = await startCandidateFootprintAudit(selectedIds, manualEmployers);
      if (isOperationCurrent(operationGeneration)) setAudit(audit);
    } catch (cause) {
      if (isOperationCurrent(operationGeneration)) {
        setError(errorText(cause, 'Не удалось запустить проверку. Проверьте план и повторите попытку.'));
      }
    } finally {
      setStarting(false);
    }
  }, [selectedIds, manualEmployers, setAudit, setError, setNotice, getOperationGeneration, isOperationCurrent]);
  return { starting, start };
}

function useFootprintConsentGrant(
  consent: CandidateFootprintConsentState,
  setConsent: (consent: CandidateFootprintConsentState) => void,
  setError: (error: string | undefined) => void,
  setNotice: (notice: string | undefined) => void,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
) {
  const [grantingConsent, setGrantingConsent] = useState(false);
  const grantConsent = useCallback(async () => {
    const operationGeneration = getOperationGeneration();
    setGrantingConsent(true);
    setError(undefined);
    try {
      await grantCandidateFootprintConsent(consent.versionId);
      if (isOperationCurrent(operationGeneration)) {
        setConsent({ ...consent, granted: true });
        setNotice('Согласие сохранено.');
      }
    } catch (cause) {
      if (isOperationCurrent(operationGeneration)) {
        setError(errorText(cause, 'Не удалось сохранить согласие. Проверьте его статус и повторите попытку.'));
      }
    } finally {
      setGrantingConsent(false);
    }
  }, [consent, setConsent, setError, setNotice, getOperationGeneration, isOperationCurrent]);
  return { grantingConsent, grantConsent };
}

function useFootprintConsentRevocation(
  consent: CandidateFootprintConsentState,
  setConsent: (consent: CandidateFootprintConsentState) => void,
  setOwnershipConfirmed: (confirmed: boolean) => void,
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  setNotice: (notice: string | undefined) => void,
  invalidatePendingRequests: () => void,
) {
  const [revokingConsent, setRevokingConsent] = useState(false);
  const revokeConsent = useCallback(async () => {
    setRevokingConsent(true);
    setError(undefined);
    try {
      await revokeCandidateFootprintConsent();
      invalidatePendingRequests();
      setConsent({ ...consent, granted: false });
      setOwnershipConfirmed(false);
      setAudit(null);
      setNotice('Согласие отозвано. Проверка остановлена, сохранённые находки удалены.');
    } catch (cause) {
      setError(errorText(cause, 'Не удалось отозвать согласие. Проверьте его статус и повторите попытку.'));
    } finally {
      setRevokingConsent(false);
    }
  }, [consent, invalidatePendingRequests, setAudit, setConsent, setError, setNotice, setOwnershipConfirmed]);
  return { revokingConsent, revokeConsent };
}

function useFootprintReviewAction(
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
) {
  const [busyFindingId, setBusyFindingId] = useState<string | undefined>();
  const review = useCallback(async (findingId: string, decision: FootprintReview) => {
    const operationGeneration = getOperationGeneration();
    setBusyFindingId(findingId);
    setError(undefined);
    try {
      const audit = await reviewCandidateFootprintFinding(findingId, decision);
      if (isOperationCurrent(operationGeneration)) setAudit(audit);
    } catch (cause) {
      if (isOperationCurrent(operationGeneration)) {
        setError(errorText(cause, 'Не удалось сохранить отметку. Обновите страницу и повторите действие.'));
      }
    } finally {
      setBusyFindingId(undefined);
    }
  }, [getOperationGeneration, isOperationCurrent, setAudit, setError]);
  return { busyFindingId, review };
}

function useFootprintDeleteAction(
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  setNotice: (notice: string | undefined) => void,
  reload: () => Promise<void>,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
  invalidatePendingRequests: () => void,
) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useCallback(async () => {
    const operationGeneration = getOperationGeneration();
    setDeleting(true);
    setError(undefined);
    try {
      await deleteCandidateFootprintFindings();
      if (!isOperationCurrent(operationGeneration)) return;
      invalidatePendingRequests();
      setAudit(null);
      setConfirmingDelete(false);
      setNotice('Сохранённые находки удалены.');
      await reload();
    } catch (cause) {
      if (isOperationCurrent(operationGeneration)) {
        setError(errorText(cause, 'Не удалось удалить находки. Повторите попытку.'));
      }
    } finally {
      setDeleting(false);
    }
  }, [getOperationGeneration, invalidatePendingRequests, isOperationCurrent, reload, setAudit, setError, setNotice]);
  return { confirmingDelete, deleting, confirmDelete, setConfirmingDelete };
}

function useFootprintFindingActions(
  setAudit: (audit: CandidateFootprintAudit | null) => void,
  setError: (error: string | undefined) => void,
  setNotice: (notice: string | undefined) => void,
  reload: () => Promise<void>,
  getOperationGeneration: () => number,
  isOperationCurrent: (expected: number) => boolean,
  invalidatePendingRequests: () => void,
) {
  const reviewAction = useFootprintReviewAction(setAudit, setError, getOperationGeneration, isOperationCurrent);
  const deleteAction = useFootprintDeleteAction(
    setAudit, setError, setNotice, reload, getOperationGeneration, isOperationCurrent,
    invalidatePendingRequests,
  );
  return { ...reviewAction, ...deleteAction };
}

function useFootprintAuditSurfaceProps(candidateId: string) {
  const data = useCandidateFootprintPlanState(candidateId);
  const manual = useManualEmployers(data.reload);
  const selection = useFootprintSelection(candidateId, data.plan);
  const start = useFootprintStart(
    selection.selectedQueryIds, data.setAudit, data.setError, data.setNotice,
    data.getOperationGeneration, data.isOperationCurrent, manual.manualEmployers,
  );
  const consentGrant = useFootprintConsentGrant(
    data.consent, data.setConsent, data.setError, data.setNotice,
    data.getOperationGeneration, data.isOperationCurrent,
  );
  const consentRevocation = useFootprintConsentRevocation(
    data.consent, data.setConsent, selection.setOwnershipConfirmed, data.setAudit,
    data.setError, data.setNotice, data.invalidatePendingRequests,
  );
  const findingActions = useFootprintFindingActions(
    data.setAudit, data.setError, data.setNotice, data.reload, data.getOperationGeneration,
    data.isOperationCurrent, data.invalidatePendingRequests,
  );

  return {
    plan: data.plan,
    unidentifiedEmployers: data.unidentifiedEmployers,
    sourceAvailability: data.sourceAvailability,
    consent: data.consent,
    audit: data.audit,
    selectedQueryIds: selection.selectedQueryIds,
    loading: data.loading,
    starting: start.starting,
    grantingConsent: consentGrant.grantingConsent,
    revokingConsent: consentRevocation.revokingConsent,
    ownershipConfirmed: selection.ownershipConfirmed,
    busyFindingId: findingActions.busyFindingId,
    confirmingDelete: findingActions.confirmingDelete,
    deleting: findingActions.deleting,
    error: data.error,
    notice: data.notice,
    onRetry: () => void data.reload(),
    onToggleQuery: selection.toggleQuery,
    onConfirmOwnership: selection.setOwnershipConfirmed,
    onGrantConsent: () => void consentGrant.grantConsent(),
    onRevokeConsent: () => void consentRevocation.revokeConsent(),
    onStart: () => void start.start(),
    onReview: findingActions.review,
    onRequestDelete: () => findingActions.setConfirmingDelete(true),
    onCancelDelete: () => findingActions.setConfirmingDelete(false),
    onConfirmDelete: () => void findingActions.confirmDelete(),
    onAddManualEmployer: manual.add,
  };
}

export function CandidateFootprintAuditView({ candidateId }: { readonly candidateId: string }) {
  const props = useFootprintAuditSurfaceProps(candidateId);
  return <CandidateFootprintAuditSurface {...props} />;
}
