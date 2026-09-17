import { executeLocalAction, isTauriEnvironment } from './desktopBridge';

export type ConnectionDegree = '1st' | '2nd' | '3rd+';

export type DecisionMakerRoleCategory =
  | 'recruiter'
  | 'engineering_lead'
  | 'executive'
  | 'peer';

export interface DecisionMakerProfile {
  id: string;
  fullName: string;
  headline: string;
  company: string;
  connectionDegree: ConnectionDegree;
  mutualConnectionsCount: number;
  profileUrl: string;
  avatarUrl?: string;
  roleCategory: DecisionMakerRoleCategory;
}

export interface OutreachDailyQuota {
  date: string;
  usedToday: number;
  dailyLimit: number;
  remaining: number;
  resetsAt: string;
  allowed: boolean;
}

export interface OutreachActionResult {
  success: boolean;
  status: 'sent' | 'limit_exceeded' | 'desktop_required' | 'failed';
  actionId?: string;
  executedAt?: string;
  errorReason?: string;
}

export interface SendOutreachRequestParams {
  profile: DecisionMakerProfile;
  note?: string;
  candidateId?: string;
}

export interface SearchDecisionMakersParams {
  company: string;
  roleCategory?: DecisionMakerRoleCategory;
  query?: string;
}

export const DEFAULT_DAILY_OUTREACH_LIMIT = 15;
const STORAGE_KEY = 'openqareer_outreach_quota_v1';

let inMemoryQuota: { date: string; usedToday: number } | null = null;

function getTodayString(customDate?: string): string {
  if (customDate) return customDate;
  return new Date().toISOString().slice(0, 10);
}

function getNextDayIso(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function readStorage(): { date: string; usedToday: number } | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return inMemoryQuota;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return inMemoryQuota;
    return JSON.parse(raw) as { date: string; usedToday: number };
  } catch {
    return inMemoryQuota;
  }
}

function writeStorage(val: { date: string; usedToday: number }): void {
  inMemoryQuota = val;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch {
      // safe fallback to in-memory
    }
  }
}

export function resetOutreachQuota(customDate?: string): void {
  const date = getTodayString(customDate);
  inMemoryQuota = { date, usedToday: 0 };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getOutreachQuota(customDate?: string): OutreachDailyQuota {
  const today = getTodayString(customDate);
  const stored = readStorage();
  const usedToday = stored && stored.date === today ? stored.usedToday : 0;
  const remaining = Math.max(0, DEFAULT_DAILY_OUTREACH_LIMIT - usedToday);
  const allowed = remaining > 0;
  const resetsAt = getNextDayIso(today);

  return {
    date: today,
    usedToday,
    dailyLimit: DEFAULT_DAILY_OUTREACH_LIMIT,
    remaining,
    resetsAt,
    allowed,
  };
}

export function canSendInvite(customDate?: string): {
  allowed: boolean;
  remaining: number;
  resetsAt: string;
  usedToday: number;
  dailyLimit: number;
} {
  const q = getOutreachQuota(customDate);
  return {
    allowed: q.allowed,
    remaining: q.remaining,
    resetsAt: q.resetsAt,
    usedToday: q.usedToday,
    dailyLimit: q.dailyLimit,
  };
}

export function recordSentInvite(customDate?: string): OutreachDailyQuota {
  const current = getOutreachQuota(customDate);
  const updatedUsed = current.usedToday + 1;
  writeStorage({ date: current.date, usedToday: updatedUsed });
  return getOutreachQuota(customDate);
}

export function getOutreachJitterMs(min = 1000, max = 3000): number {
  const safeMin = Math.max(200, min);
  const safeMax = Math.max(safeMin, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export function sleepWithJitter(min = 1000, max = 3000): Promise<number> {
  const delay = getOutreachJitterMs(min, max);
  return new Promise((resolve) => setTimeout(() => resolve(delay), delay));
}

function generateActionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `outreach_${Date.now()}_${rand}`;
}

export async function sendDesktopConnectionRequest({
  profile,
  note,
  candidateId,
}: SendOutreachRequestParams): Promise<OutreachActionResult> {
  const quota = canSendInvite();
  if (!quota.allowed) {
    return {
      success: false,
      status: 'limit_exceeded',
      errorReason: 'Достигнут безопасный дневной лимит инвайтов (15 в день).',
    };
  }

  if (!isTauriEnvironment()) {
    return {
      success: false,
      status: 'desktop_required',
      errorReason:
        'Прямая отправка доступна только в локальной сессии десктопного приложения (ADR-009).',
    };
  }

  const actionId = generateActionId();
  const trimmedNote = (note ?? '').slice(0, 300);

  const localResult = await executeLocalAction({
    action_id: actionId,
    capability: 'outreach.send_connection_request',
    platform: 'linkedin',
    payload: {
      targetProfileUrl: profile.profileUrl,
      targetFullName: profile.fullName,
      connectionNote: trimmedNote,
    },
    candidate_id: candidateId,
  });

  if (!localResult || localResult.status === 'failed') {
    return {
      success: false,
      status: 'failed',
      actionId,
      errorReason: 'Локальное действие в десктопной сессии не удалось.',
    };
  }

  recordSentInvite();

  return {
    success: true,
    status: 'sent',
    actionId: localResult.action_id,
    executedAt: localResult.executed_at,
  };
}

export function buildSyntheticProfiles(company: string): DecisionMakerProfile[] {
  const cleanCompany = company.trim() || 'Компания';
  return [
    {
      id: `dm_${cleanCompany}_1`,
      fullName: 'Анна Воронова',
      headline: `Tech Recruiter / Talent Acquisition at ${cleanCompany}`,
      company: cleanCompany,
      connectionDegree: '1st',
      mutualConnectionsCount: 12,
      profileUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleanCompany)}+recruiter`,
      roleCategory: 'recruiter',
    },
    {
      id: `dm_${cleanCompany}_2`,
      fullName: 'Михаил Соколов',
      headline: `Head of Engineering / VP Tech at ${cleanCompany}`,
      company: cleanCompany,
      connectionDegree: '2nd',
      mutualConnectionsCount: 6,
      profileUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleanCompany)}+engineering+head`,
      roleCategory: 'engineering_lead',
    },
    {
      id: `dm_${cleanCompany}_3`,
      fullName: 'Дмитрий Мельников',
      headline: `Chief Technology Officer (CTO) at ${cleanCompany}`,
      company: cleanCompany,
      connectionDegree: '2nd',
      mutualConnectionsCount: 3,
      profileUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleanCompany)}+cto`,
      roleCategory: 'executive',
    },
    {
      id: `dm_${cleanCompany}_4`,
      fullName: 'Сергей Белов',
      headline: `Staff Software Engineer / Tech Lead at ${cleanCompany}`,
      company: cleanCompany,
      connectionDegree: '3rd+',
      mutualConnectionsCount: 0,
      profileUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleanCompany)}+tech+lead`,
      roleCategory: 'peer',
    },
  ];
}

export async function searchDecisionMakers({
  company,
  roleCategory,
}: SearchDecisionMakersParams): Promise<DecisionMakerProfile[]> {
  const list = buildSyntheticProfiles(company);
  if (!roleCategory) return list;
  return list.filter((item) => item.roleCategory === roleCategory);
}
