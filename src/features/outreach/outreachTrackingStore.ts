export type OutreachStatus =
  | 'draft'
  | 'invite_sent'
  | 'connected'
  | 'dialogue_started'
  | 'rejected';

export interface OutreachRecord {
  id: string;
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
  vacancyId?: string;
  company: string;
  contactName: string;
  contactProfileUrl: string;
  connectionNote?: string;
  status?: OutreachStatus;
}

const STORAGE_KEY = 'openqareer_outreach_records_v1';

let inMemoryRecords: OutreachRecord[] = [];

function readRecordsFromStorage(): OutreachRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return inMemoryRecords;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return inMemoryRecords;
    return JSON.parse(raw) as OutreachRecord[];
  } catch {
    return inMemoryRecords;
  }
}

function writeRecordsToStorage(records: OutreachRecord[]): void {
  inMemoryRecords = records;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // In-memory fallback
    }
  }
}

export function clearOutreachStore(): void {
  inMemoryRecords = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getOutreachRecords(vacancyId?: string): OutreachRecord[] {
  const records = readRecordsFromStorage();
  if (!vacancyId) return records;
  return records.filter((r) => r.vacancyId === vacancyId);
}

export function getOutreachRecordById(id: string): OutreachRecord | undefined {
  const records = readRecordsFromStorage();
  return records.find((r) => r.id === id);
}

function generateRecordId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `outreach_rec_${Date.now()}_${rand}`;
}

export function recordOutreachInvite(
  params: RecordOutreachInviteParams,
): OutreachRecord {
  const records = readRecordsFromStorage();
  const now = new Date().toISOString();
  const status = params.status ?? 'invite_sent';

  const newRecord: OutreachRecord = {
    id: generateRecordId(),
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
  writeRecordsToStorage(updatedList);
  return newRecord;
}

export function updateOutreachStatus(
  id: string,
  status: OutreachStatus,
): OutreachRecord | null {
  const records = readRecordsFromStorage();
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
  writeRecordsToStorage(updatedList);
  return updated;
}
