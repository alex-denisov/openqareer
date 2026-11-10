import { useEffect, useState } from 'react';
import type { CandidateAutomationSnapshot, AutomationQueueItem, AutomationJournalPage } from './automationApi';
import { getCandidateAutomation, listCandidateAutomationJournal, listCandidateAutomationQueue } from './automationApi';
import { apiErrorMessage } from '../coach/apiClient';
import { SECTION_CACHE_KEYS, readSectionCache, writeSectionCache } from '../shell/sectionCache';

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

interface CachedAutomationQueue {
  readonly items: AutomationQueueItem[];
  readonly total: number;
}

// B589: each part starts from its last reading and the reads below refresh it.
function useAutomationSnapshot(candidateId: string) {
  const [snapshot, setSnapshot] = useState<CandidateAutomationSnapshot | null>(
    () => readSectionCache<CandidateAutomationSnapshot>(SECTION_CACHE_KEYS.automationSnapshot) ?? null,
  );
  const [snapshotLoading, setSnapshotLoading] = useState(snapshot === null);
  useEffect(() => {
    if (snapshot) writeSectionCache(SECTION_CACHE_KEYS.automationSnapshot, snapshot);
  }, [snapshot]);
  const [snapshotError, setSnapshotError] = useState('');

  async function reloadSnapshot() {
    setSnapshotError('');
    const data = await getCandidateAutomation();
    setSnapshot(data);
    return data;
  }

  useEffect(() => {
    let active = true;
    void getCandidateAutomation().then((data) => { if (active) setSnapshot(data); })
      .catch((reason: unknown) => { if (active) setSnapshotError(apiErrorMessage(reason, 'Не удалось загрузить настройки автооткликов.')); })
      .finally(() => { if (active) setSnapshotLoading(false); });
    return () => { active = false; };
  }, [candidateId]);
  return { snapshot, snapshotLoading, snapshotError, setSnapshotError, reloadSnapshot };
}

function useAutomationQueue(candidateId: string) {
  const [cached] = useState(() => readSectionCache<CachedAutomationQueue>(SECTION_CACHE_KEYS.automationQueue));
  const [queue, setQueue] = useState<AutomationQueueItem[]>(cached?.items ?? []);
  const [queueTotal, setQueueTotal] = useState(cached?.total ?? 0);
  const [queueOffset, setQueueOffset] = useState(cached?.items.length ?? 0);
  const [queueLoading, setQueueLoading] = useState(!cached);
  const [queueRead, setQueueRead] = useState(Boolean(cached));
  useEffect(() => {
    if (queueRead) writeSectionCache(SECTION_CACHE_KEYS.automationQueue, { items: queue, total: queueTotal });
  }, [queue, queueRead, queueTotal]);
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
    void listCandidateAutomationQueue({ limit: 100, offset: 0 }).then((page) => {
      if (active) { setQueue(page.items); setQueueTotal(page.total); setQueueOffset(page.items.length); setQueueRead(true); }
    }).catch((reason: unknown) => {
      if (active) setQueueError(apiErrorMessage(reason, 'Не удалось загрузить очередь.'));
    }).finally(() => { if (active) setQueueLoading(false); });
    return () => { active = false; };
  }, [candidateId]);
  return { queue, queueTotal, queueOffset, queueLoading, queueError, setQueueError, reloadQueue };
}

function useAutomationJournal(candidateId: string) {
  const [journal, setJournal] = useState<AutomationJournalPage | null>(
    () => readSectionCache<AutomationJournalPage>(SECTION_CACHE_KEYS.automationJournal) ?? null,
  );
  const [journalLoading, setJournalLoading] = useState(journal === null);
  const [journalError, setJournalError] = useState('');
  const [journalFilter, setJournalFilter] = useState<AutomationJournalFilter>({ periodDays: 30 });
  // Only the default 30-day journal is kept: every mount starts from it.
  useEffect(() => {
    if (journal && isDefaultJournalFilter(journalFilter)) writeSectionCache(SECTION_CACHE_KEYS.automationJournal, journal);
  }, [journal, journalFilter]);

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

function isDefaultJournalFilter(filter: AutomationJournalFilter): boolean {
  return filter.periodDays === 30 && !filter.result && !filter.platform;
}
