import { useSyncExternalStore } from 'react';

/** The detail pages the LinkedIn walk reads, named the way the candidate knows them. */
const STAGE_LABELS = {
  experience: 'места работы',
  education: 'образование',
  skills: 'навыки',
  certifications: 'сертификаты',
  projects: 'проекты',
  languages: 'языки',
  courses: 'курсы',
  contactInfo: 'контакты',
  recommendations: 'рекомендации',
} as const;

export type LinkedInImportStageKey = keyof typeof STAGE_LABELS;

export interface LinkedInImportProgress {
  readonly keys: readonly LinkedInImportStageKey[];
  readonly read: readonly LinkedInImportStageKey[];
}

export type LinkedInImportProgressEvent =
  | { readonly type: 'start'; readonly keys: readonly LinkedInImportStageKey[] }
  | { readonly type: 'read'; readonly key: LinkedInImportStageKey }
  | { readonly type: 'end' };

export interface LinkedInImportProgressView {
  readonly readCount: number;
  readonly total: number;
  readonly stages: readonly {
    readonly key: LinkedInImportStageKey;
    readonly label: string;
    readonly done: boolean;
  }[];
}

export function reduceLinkedInImportProgress(
  state: LinkedInImportProgress | null,
  event: LinkedInImportProgressEvent,
): LinkedInImportProgress | null {
  if (event.type === 'start') return { keys: event.keys, read: [] };
  if (event.type === 'end' || !state) return null;
  if (!state.keys.includes(event.key) || state.read.includes(event.key)) return state;
  return { ...state, read: [...state.read, event.key] };
}

export function linkedinImportProgressView(
  state: LinkedInImportProgress | null,
): LinkedInImportProgressView | null {
  if (!state) return null;
  return {
    readCount: state.read.length,
    total: state.keys.length,
    stages: state.keys.map((key) => ({
      key,
      label: STAGE_LABELS[key],
      done: state.read.includes(key),
    })),
  };
}

let current: LinkedInImportProgress | null = null;
const listeners = new Set<() => void>();

/** One walk at a time per window, so a module-level store is enough to reach the profile screen. */
export function applyLinkedInImportProgress(event: LinkedInImportProgressEvent): void {
  const next = reduceLinkedInImportProgress(current, event);
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLinkedInImportProgress(): LinkedInImportProgress | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
