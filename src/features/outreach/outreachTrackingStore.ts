export type OutreachStatus =
  | 'draft'
  | 'invite_sent'
  | 'connected'
  | 'dialogue_started'
  | 'rejected';

export interface OutreachRecord {
  id: string;
  candidateId?: string;
  vacancyId?: string;
  company: string;
  contactName: string;
  contactProfileUrl: string;
  connectionNote?: string;
  status: OutreachStatus;
  sentAt?: string;
  updatedAt: string;
}

export interface RecordOutreachInviteParams {
  candidateId?: string;
  vacancyId?: string;
  company: string;
  contactName: string;
  contactProfileUrl: string;
  connectionNote?: string;
  status?: OutreachStatus;
}

const STORAGE_KEY = 'openqareer_outreach_records_v1';

function storageKey(candidateId?: string): string {
  return STORAGE_KEY + ':' + (candidateId || 'unscoped');
}

const inMemoryRecords = new Map<string, OutreachRecord[]>();

function inMemoryKey(candidateId?: string): string {
  return candidateId || 'unscoped';
}

function readRecordsFromStorage(candidateId?: string): OutreachRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return inMemoryRecords.get(inMemoryKey(candidateId)) ?? [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey(candidateId));
    if (!raw) return inMemoryRecords.get(inMemoryKey(candidateId)) ?? [];
    const records = JSON.parse(raw) as OutreachRecord[];
    inMemoryRecords.set(inMemoryKey(candidateId), records);
    return records;
  } catch {
    return inMemoryRecords.get(inMemoryKey(candidateId)) ?? [];
  }
}

function writeRecordsToStorage(records: OutreachRecord[], candidateId?: string): void {
  inMemoryRecords.set(inMemoryKey(candidateId), records);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
    window.localStorage.setItem(storageKey(candidateId), JSON.stringify(records));
    } catch {
      // In-memory fallback
    }
  }
}

export function clearOutreachStore(candidateId?: string): void {
  inMemoryRecords.delete(inMemoryKey(candidateId));
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
    window.localStorage.removeItem(storageKey(candidateId));
    } catch {
      // ignore
    }
  }
}

export function getOutreachRecords(candidateId?: string, vacancyId?: string): OutreachRecord[] {
  const scoped = vacancyId !== undefined;
  const actualCandidateId = scoped ? candidateId : undefined;
  const actualVacancyId = scoped ? vacancyId : candidateId;
  const records = readRecordsFromStorage(actualCandidateId);
  if (!actualVacancyId) return records;
  return records.filter((r) => r.vacancyId === actualVacancyId);
}

export function getOutreachRecordById(id: string, candidateId?: string): OutreachRecord | undefined {
  const records = readRecordsFromStorage(candidateId);
  return records.find((r) => r.id === id);
}

function generateRecordId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `outreach_rec_${Date.now()}_${rand}`;
}

export function recordOutreachInvite(
  params: RecordOutreachInviteParams,
): OutreachRecord {
  const records = readRecordsFromStorage(params.candidateId);
  const now = new Date().toISOString();
  const status = params.status ?? 'invite_sent';

  const newRecord: OutreachRecord = {
    id: generateRecordId(),
    candidateId: params.candidateId,
    vacancyId: params.vacancyId,
    company: params.company,
    contactName: params.contactName,
    contactProfileUrl: params.contactProfileUrl,
    connectionNote: params.connectionNote,
    status,
    sentAt: status === 'invite_sent' ? now : undefined,
    updatedAt: now,
  };

  const updatedList = [newRecord, ...records];
  writeRecordsToStorage(updatedList, params.candidateId);
  return newRecord;
}

export function updateOutreachStatus(
  id: string,
  status: OutreachStatus,
  candidateId?: string,
): OutreachRecord | null {
  const records = readRecordsFromStorage(candidateId);
  const targetIndex = records.findIndex((r) => r.id === id);
  if (targetIndex === -1) return null;

  const current = records[targetIndex];
  const now = new Date().toISOString();
  const updated: OutreachRecord = {
    ...current,
    status,
    updatedAt: now,
    sentAt:
      status === 'invite_sent' && !current.sentAt ? now : current.sentAt,
  };

  const updatedList = [...records];
  updatedList[targetIndex] = updated;
  writeRecordsToStorage(updatedList, candidateId);
  return updated;
}
