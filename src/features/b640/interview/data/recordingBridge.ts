import { apiFetch, readDataObject } from '../../../coach/apiClient';
import { invokeDesktopCommand, isTauriEnvironment } from '../../../../services/desktop/desktopBridge';

/**
 * B751 ↔ D2 (#870): запись интервью в .app. Команды и событие — по контракту D2
 * (заметка queue-d2-b642-app-interface.md); создание и итог записи — сервер B642.
 */
export interface RecordingPermissions {
  readonly supported: boolean;
  readonly microphone: boolean;
  readonly screen: boolean;
}

export type RecordingPhase = 'recording' | 'uploading' | 'idle' | 'error';

export interface RecordingStateEvent {
  readonly state: RecordingPhase;
  readonly elapsedMs: number;
  readonly error?: string;
}

export interface CreatedRecording {
  readonly recordingId: string;
  readonly uploadUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface StopResult {
  readonly segments: number;
  readonly failed: number;
}

/** Как в apiFetchOnce: нативный вызов только внутри .app с мостом Tauri. */
export function canRecordInApp(): boolean {
  return isTauriEnvironment() && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function recordingPermissions(): Promise<RecordingPermissions> {
  if (!canRecordInApp()) return { supported: false, microphone: false, screen: false };
  return (
    (await invokeDesktopCommand<RecordingPermissions>('recording_permissions')) ?? {
      supported: false,
      microphone: false,
      screen: false,
    }
  );
}

/** `mic` (B758, #942): только микрофон, без окна «Запись экрана»; без режима — для встречи. */
export async function requestRecordingPermissions(mode?: 'mic'): Promise<RecordingPermissions> {
  const granted = await invokeDesktopCommand<RecordingPermissions>(
    'recording_request_permissions',
    mode ? { mode } : undefined,
  );
  return granted ?? { supported: false, microphone: false, screen: false };
}

async function createRecording(
  applicationId: string,
  interviewId: string,
  continues?: string,
): Promise<CreatedRecording> {
  const path = `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/interviews/${encodeURIComponent(interviewId)}/recordings`;
  const init: RequestInit = continues
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ continues }),
      }
    : { method: 'POST' };
  return readDataObject<CreatedRecording>(await apiFetch(path, init));
}

/** Начать запись в .app по уже созданной на сервере. */
export async function launchRecording(
  created: CreatedRecording,
  mode?: 'mic',
): Promise<void> {
  // `mic` (B758, #930): только микрофон, без доступа к экрану; без режима — встреча, две дорожки.
  await invokeDesktopCommand('recording_start', {
    resourceId: created.recordingId,
    uploadUrl: created.uploadUrl,
    headers: created.headers,
    ...(mode ? { mode } : {}),
  });
}

/** Создать запись на сервере и начать её в .app. */
export async function startRecording(
  applicationId: string,
  interviewId: string,
): Promise<CreatedRecording> {
  const created = await createRecording(applicationId, interviewId);
  await launchRecording(created);
  return created;
}

/**
 * «Продолжить» после сбоя: .app начинает сегменты заново с нуля, поэтому прежняя часть
 * закрывается, а продолжение — новая запись на сервере, связанная с прежней.
 */
export async function resumeRecording(
  applicationId: string,
  interviewId: string,
  previous: CreatedRecording,
): Promise<CreatedRecording> {
  // Остановка дожидается отправки готовых сегментов; если захват уже закрыт сбоем — итог без счёта.
  await stopRecording(previous.recordingId).catch(() =>
    finishPart(previous.recordingId, { segments: 0, failed: 0 }),
  );
  const created = await createRecording(applicationId, interviewId, previous.recordingId);
  await launchRecording(created);
  return created;
}

async function finishPart(recordingId: string, result: StopResult): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/recordings/${encodeURIComponent(recordingId)}/finish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    },
  );
  await readDataObject<object>(response);
}

/** Остановить в .app и закрыть запись на сервере: дальше идёт расшифровка. */
export async function stopRecording(recordingId: string): Promise<void> {
  const result = (await invokeDesktopCommand<StopResult>('recording_stop')) ?? {
    segments: 0,
    failed: 0,
  };
  await finishPart(recordingId, result);
}

/** Подписка на `recording://state`; возвращает отписку. */
export async function onRecordingState(
  handler: (event: RecordingStateEvent) => void,
): Promise<() => void> {
  if (!canRecordInApp()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<RecordingStateEvent>('recording://state', (event) => handler(event.payload));
}

/** Ошибки старта из контракта D2 — строка на экране. */
export function startErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes('microphone_permission')) return 'Разрешите приложению доступ к микрофону.';
  if (code.includes('screen_permission')) return 'Разрешите приложению запись звука с экрана.';
  if (code.includes('unsupported')) return 'Запись звонка работает на macOS 15 и новее.';
  return 'Запись не началась. Попробуйте ещё раз.';
}
