import { useSyncExternalStore } from 'react';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  closeConnectorSession,
  inspectSessionPage,
  isConnectorSessionOpen,
  openConnectorSession,
  parkConnectorSession,
  readSessionPage,
  resizeConnectorSession,
  showConnectorSession,
  type SessionInspectionResult,
  type SessionLayout,
  type SessionPageResult,
} from './connectorSession';
import { workAreaLayout } from './connectorLayout';
import { createImportWalkSync } from './importWalkSync';
import {
  applyLinkedInImportProgress,
  type LinkedInImportProgressEvent,
} from './linkedinImportProgress';
import { startLinkedInCompanySearch } from './linkedinCompanySearch';
import { startLinkedInContactsRefresh } from './linkedinContactsRefresh';
import {
  endLinkedInProtectedRoute,
  protectedRouteFailureMessage,
  startLinkedInProtectedRoute,
} from './linkedinProtectedRoute';
import {
  createLinkedInSessionImportFlow,
  linkedinWaitingNotice,
  type DetailReadThrottle,
  type LinkedInSessionPollResult,
} from './linkedinSessionPoll';
import type { SessionWaitingStage } from './sessionWaitingStage';

export type LinkedInReadyCapture = Extract<LinkedInSessionPollResult, { status: 'ready' }>;

/**
 * Where the out-of-sight import stands. `needs_person` is the only phase with
 * a window on screen: LinkedIn asked for a sign-in, a code or a captcha.
 */
export type LinkedInBackgroundState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'opening' }
  | { readonly phase: 'needs_person'; readonly message: string }
  | { readonly phase: 'reading' }
  | { readonly phase: 'saving' }
  | { readonly phase: 'done'; readonly message: string }
  | { readonly phase: 'failed'; readonly message: string };

type Outcome = Extract<LinkedInBackgroundState, { phase: 'done' | 'failed' }>;

export interface LinkedInBackgroundImportDependencies {
  readonly prepareRoute: () => Promise<{ readonly release: () => Promise<void> }>;
  readonly isWindowOpen: () => Promise<boolean>;
  /** Opens the session window past the main window's edge, without focus. */
  readonly openOutOfSight: () => Promise<boolean>;
  /** Puts the window over the work area and focuses it: a person is needed. */
  readonly reveal: () => Promise<void>;
  /** Moves the window back out of sight and returns focus to the cabinet. */
  readonly park: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly inspectCurrentPage: () => Promise<SessionInspectionResult>;
  readonly readSessionPage: (url: string) => Promise<SessionPageResult>;
  /** Saves the capture; returns what the candidate is told when it is done. */
  readonly persist: (capture: LinkedInReadyCapture) => Promise<string | void>;
  readonly onState: (state: LinkedInBackgroundState) => void;
  readonly onDetailProgress?: (event: LinkedInImportProgressEvent) => void;
  readonly detailReadThrottle?: DetailReadThrottle;
  readonly pauseBetweenDetailReads?: () => Promise<void>;
  readonly waitBeforeRetry?: (attempt: number) => Promise<void>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const POLL_INTERVAL_MS = 750;
/** A contacts refresh or company search may hold the window; wait it out. */
const BUSY_WAIT_LIMIT_MS = 5 * 60_000;
const BUSY_POLL_MS = 2_000;
/** A page that does not settle unattended is handed to the candidate. */
const HIDDEN_PATIENCE_MS = 30_000;
const UNRECOGNISED_PATIENCE_POLLS = 8;
/** Nobody signed in: the window is closed rather than left open for ever. */
const SIGN_IN_LIMIT_MS = 15 * 60_000;
const PERSON_STAGES: ReadonlySet<SessionWaitingStage> = new Set(['login', 'otp', 'captcha']);
const DONE_MESSAGE = 'Профиль из LinkedIn обновлён.';
export const LINKEDIN_BACKGROUND_NOTICE =
  'Импорт LinkedIn идёт в фоне. Окно LinkedIn откроется, только если понадобится войти.';

const MESSAGES = {
  windowFailed: 'Не удалось открыть LinkedIn в фоне. Перезапустите приложение и повторите импорт.',
  busy: 'LinkedIn сейчас занят другим чтением. Повторите импорт через несколько минут.',
  closed: 'Окно LinkedIn закрыто, импорт не завершён. Профиль не изменился.',
  signInTimeout: 'Вход в LinkedIn не завершён. Профиль не изменился — повторите импорт.',
  captureFailed:
    'Вход в LinkedIn выполнен, но получить данные профиля не удалось. Повторите импорт или загрузите PDF-экспорт.',
  saveFailed: 'Профиль LinkedIn прочитан, но сохранить его не удалось. Повторите импорт.',
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the LinkedIn profile import out of sight (owner, 30.10): the window
 * opens past the main window's edge without focus, and is put on screen only
 * while LinkedIn asks a person to sign in, enter a code or pass a captcha.
 * The anti-ban rules of the walk itself — pauses, page cap, 12 h interval,
 * stop on the first unanswered section — stay in the session flow.
 */
export async function runLinkedInBackgroundImport(
  dependencies: LinkedInBackgroundImportDependencies,
): Promise<Outcome> {
  const finish = (outcome: Outcome): Outcome => {
    dependencies.onState(outcome);
    return outcome;
  };
  dependencies.onState({ phase: 'opening' });
  if (!(await waitForFreeWindow(dependencies)))
    return finish({ phase: 'failed', message: MESSAGES.busy });
  let route: { readonly release: () => Promise<void> };
  try {
    route = await dependencies.prepareRoute();
  } catch (reason) {
    return finish({ phase: 'failed', message: protectedRouteFailureMessage(reason) });
  }
  try {
    const opened = await dependencies.openOutOfSight().catch(() => false);
    if (!opened) return finish({ phase: 'failed', message: MESSAGES.windowFailed });
    return finish(await pollUntilImported(dependencies));
  } finally {
    await dependencies.close().catch(() => undefined);
    await route.release().catch(() => undefined);
  }
}

async function waitForFreeWindow(dependencies: LinkedInBackgroundImportDependencies) {
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? Date.now;
  const started = now();
  while (await dependencies.isWindowOpen().catch(() => false)) {
    if (now() - started >= BUSY_WAIT_LIMIT_MS) return false;
    await sleep(BUSY_POLL_MS);
  }
  return true;
}

/** Where one run stands between polls. */
interface RunProgress {
  revealed: boolean;
  signedIn: boolean;
}

function createBackgroundFlow(
  dependencies: LinkedInBackgroundImportDependencies,
  progress: RunProgress,
) {
  return createLinkedInSessionImportFlow({
    inspectCurrentPage: dependencies.inspectCurrentPage,
    readSessionPage: dependencies.readSessionPage,
    onDetailProgress: dependencies.onDetailProgress,
    detailReadThrottle: dependencies.detailReadThrottle,
    pauseBetweenDetailReads: dependencies.pauseBetweenDetailReads,
    waitBeforeRetry: dependencies.waitBeforeRetry,
    onAuthenticated: async () => {
      progress.signedIn = true;
      if (progress.revealed) {
        progress.revealed = false;
        await dependencies.park().catch(() => undefined);
      }
      dependencies.onState({ phase: 'reading' });
    },
    onProviderDataCaptured: () => dependencies.close().catch(() => undefined),
    onReady: () => undefined,
  });
}

async function pollUntilImported(
  dependencies: LinkedInBackgroundImportDependencies,
): Promise<Outcome> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? Date.now;
  const started = now();
  const progress: RunProgress = { revealed: false, signedIn: false };
  const flow = createBackgroundFlow(dependencies, progress);
  let unrecognised = 0;
  for (;;) {
    if (!progress.signedIn && !(await dependencies.isWindowOpen().catch(() => false))) {
      return { phase: 'failed', message: MESSAGES.closed };
    }
    let result: LinkedInSessionPollResult;
    try {
      result = await flow.run();
    } catch {
      // Before sign-in a page that cannot be read yet is waited through; after
      // it, one failed capture ends the attempt (B157).
      if (progress.signedIn) return { phase: 'failed', message: MESSAGES.captureFailed };
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (result.status === 'ready') return save(dependencies, result);
    unrecognised = result.stage === 'unrecognised' ? unrecognised + 1 : 0;
    const waited = now() - started;
    if (!progress.revealed && needsPerson(result.stage, unrecognised, waited)) {
      progress.revealed = true;
      await dependencies.reveal().catch(() => undefined);
    }
    if (progress.revealed) {
      const notice = linkedinWaitingNotice(result.stage, unrecognised);
      dependencies.onState({ phase: 'needs_person', message: notice.text });
    }
    if (waited >= SIGN_IN_LIMIT_MS) return { phase: 'failed', message: MESSAGES.signInTimeout };
    await sleep(POLL_INTERVAL_MS);
  }
}

function needsPerson(stage: SessionWaitingStage, unrecognised: number, waitedMs: number): boolean {
  return (
    PERSON_STAGES.has(stage) ||
    unrecognised >= UNRECOGNISED_PATIENCE_POLLS ||
    waitedMs >= HIDDEN_PATIENCE_MS
  );
}

async function save(
  dependencies: LinkedInBackgroundImportDependencies,
  capture: LinkedInReadyCapture,
): Promise<Outcome> {
  dependencies.onState({ phase: 'saving' });
  try {
    const message = await dependencies.persist(capture);
    return { phase: 'done', message: message || DONE_MESSAGE };
  } catch {
    return { phase: 'failed', message: MESSAGES.saveFailed };
  }
}

let state: LinkedInBackgroundState = { phase: 'idle' };
const listeners = new Set<() => void>();
let inFlight: Promise<Outcome> | undefined;

function publish(next: LinkedInBackgroundState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLinkedInBackgroundImport(): LinkedInBackgroundState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Clears a finished run's message once the candidate has seen it. */
export function dismissLinkedInBackgroundImport(): void {
  if (state.phase === 'done' || state.phase === 'failed') publish({ phase: 'idle' });
}

/** Whether this app can read LinkedIn out of sight at all. */
export function canImportLinkedInInBackground(): boolean {
  return isTauriEnvironment();
}

export function showLinkedInImportWindow(): Promise<boolean> {
  return showConnectorSession('linkedin');
}

const OUT_OF_SIGHT_GAP_PX = 4_000;
const OUT_OF_SIGHT_WIDTH_PX = 1156;
const OUT_OF_SIGHT_HEIGHT_PX = 900;
const FALLBACK_LAYOUT: SessionLayout = { x: 180, y: 140, width: 920, height: 620 };
const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login?locale=en_US';

function outOfSightLayout(): SessionLayout {
  return {
    x: window.innerWidth + OUT_OF_SIGHT_GAP_PX,
    y: 0,
    width: OUT_OF_SIGHT_WIDTH_PX,
    height: OUT_OF_SIGHT_HEIGHT_PX,
  };
}

/**
 * Starts the out-of-sight import in the desktop shell; a second call while
 * one runs joins it. `persist` saves the capture and says what was saved.
 * Contacts and the company search follow a finished import, as before (B448).
 */
export function startLinkedInBackgroundImport(
  persist: (capture: LinkedInReadyCapture) => Promise<string | void>,
): Promise<Outcome> {
  if (inFlight) return inFlight;
  const syncWalk = createImportWalkSync();
  inFlight = runLinkedInBackgroundImport({
    prepareRoute: async () => {
      const route = await startLinkedInProtectedRoute();
      return {
        release: () => (route.tunnelActive ? endLinkedInProtectedRoute() : Promise.resolve()),
      };
    },
    isWindowOpen: () => isConnectorSessionOpen('linkedin'),
    openOutOfSight: async () =>
      (
        await openConnectorSession('linkedin', LINKEDIN_LOGIN_URL, outOfSightLayout(), {
          background: true,
        })
      ).opened,
    reveal: async () => {
      const layout = workAreaLayout(document.getElementById('career-main')) ?? FALLBACK_LAYOUT;
      await resizeConnectorSession('linkedin', layout);
      await showConnectorSession('linkedin');
    },
    park: async () => {
      await parkConnectorSession('linkedin', outOfSightLayout());
    },
    close: () => closeConnectorSession('linkedin'),
    inspectCurrentPage: () => inspectSessionPage('linkedin'),
    readSessionPage: (url) => readSessionPage('linkedin', url),
    persist,
    onState: publish,
    onDetailProgress: (event) => {
      applyLinkedInImportProgress(event);
      syncWalk(event);
    },
  })
    .then((outcome) => {
      if (outcome.phase === 'done') {
        void startLinkedInContactsRefresh(true).then(() => startLinkedInCompanySearch(true));
      }
      return outcome;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
