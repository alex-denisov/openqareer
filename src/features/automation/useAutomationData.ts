import { useEffect, useState } from 'react';
import type { CandidateAutomationSnapshot, AutomationQueueItem, AutomationJournalPage } from './automationApi';
import { getCandidateAutomation, listCandidateAutomationJournal, listCandidateAutomationQueue } from './automationApi';
import { apiErrorMessage } from '../coach/apiClient';

export interface AutomationJournalFilter {
  readonly periodDays: number;
  readonly result?: 'delivered' | 'error' | 'removed';
  readonly platform?: 'hh' | 'linkedin';
}

export function useAutomationData(candidateId: string) {
  const snapshot = useAutomationSnapshot(candidateId);
  const queue = useAutomationQueue(candidateId);
  const journal = useAutomationJournal(candidateId);
  return { ...snapshot, ...queue, ...journal };
}

function useAutomationSnapshot(candidateId: string) {
  const [snapshot, setSnapshot] = useState<CandidateAutomationSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState('');

  async function reloadSnapshot() {
    setSnapshotError('');
    const data = await getCandidateAutomation();
    setSnapshot(data);
    return data;
  }

  useEffect(() => {
    let active = true;
    setSnapshotLoading(true);
    void getCandidateAutomation().then((data) => { if (active) setSnapshot(data); })
      .catch((reason: unknown) => { if (active) setSnapshotError(apiErrorMessage(reason, 'Не удалось загрузить настройки автооткликов.')); })
      .finally(() => { if (active) setSnapshotLoading(false); });
    return () => { active = false; };
  }, [candidateId]);
  return { snapshot, snapshotLoading, snapshotError, setSnapshotError, reloadSnapshot };
}

function useAutomationQueue(candidateId: string) {
  const [queue, setQueue] = useState<AutomationQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueOffset, setQueueOffset] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

  async function reloadQueue(append = false) {
    setQueueError('');
    setQueueLoading(true);
    const offset = append ? queueOffset : 0;
    try {
      const page = await listCandidateAutomationQueue({ limit: 100, offset });
      setQueue((current) => append ? [...current, ...page.items] : page.items);
      setQueueTotal(page.total);
      setQueueOffset(offset + page.items.length);
    } catch (reason: unknown) {
      setQueueError(apiErrorMessage(reason, 'Не удалось загрузить очередь.'));
    } finally {
      setQueueLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    setQueueLoading(true);
    void listCandidateAutomationQueue({ limit: 100, offset: 0 }).then((page) => {
      if (active) { setQueue(page.items); setQueueTotal(page.total); setQueueOffset(page.items.length); }
    }).catch((reason: unknown) => {
      if (active) setQueueError(apiErrorMessage(reason, 'Не удалось загрузить очередь.'));
    }).finally(() => { if (active) setQueueLoading(false); });
    return () => { active = false; };
  }, [candidateId]);
  return { queue, queueTotal, queueOffset, queueLoading, queueError, setQueueError, reloadQueue };
}

function useAutomationJournal(candidateId: string) {
  const [journal, setJournal] = useState<AutomationJournalPage | null>(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalError, setJournalError] = useState('');
  const [journalFilter, setJournalFilter] = useState<AutomationJournalFilter>({ periodDays: 30 });

  async function reloadJournal(filter = journalFilter, append = false) {
    setJournalError('');
    setJournalLoading(true);
    try {
      const offset = append ? journal?.entries.length ?? 0 : 0;
      const page = await listCandidateAutomationJournal({ ...filter, limit: 100, offset });
      setJournal((current) => append && current ? { ...page, entries: [...current.entries, ...page.entries] } : page);
      setJournalFilter(filter);
    } catch (reason: unknown) {
      setJournalError(apiErrorMessage(reason, 'Не удалось загрузить журнал.'));
    } finally {
      setJournalLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void listCandidateAutomationJournal({ periodDays: 30, limit: 100, offset: 0 }).then((page) => {
      if (active) setJournal(page);
    }).catch((reason: unknown) => {
      if (active) setJournalError(apiErrorMessage(reason, 'Не удалось загрузить журнал.'));
    }).finally(() => { if (active) setJournalLoading(false); });
    return () => { active = false; };
  }, [candidateId]);
  return { journal, journalLoading, journalError, journalFilter, setJournalFilter, reloadJournal };
}
