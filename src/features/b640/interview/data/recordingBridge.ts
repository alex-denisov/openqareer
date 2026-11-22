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

export async function requestRecordingPermissions(): Promise<RecordingPermissions> {
  const granted = await invokeDesktopCommand<RecordingPermissions>('recording_request_permissions');
  return granted ?? { supported: false, microphone: false, screen: false };
}

async function createRecording(applicationId: string, interviewId: string): Promise<CreatedRecording> {
  const path = `/api/v1/candidate/applications/${encodeURIComponent(applicationId)}/interviews/${encodeURIComponent(interviewId)}/recordings`;
  return readDataObject<CreatedRecording>(await apiFetch(path, { method: 'POST' }));
}

/** Начать (или после сбоя продолжить) запись в .app по уже созданной на сервере. */
export async function resumeRecording(created: CreatedRecording): Promise<void> {
  await invokeDesktopCommand('recording_start', {
    resourceId: created.recordingId,
    uploadUrl: created.uploadUrl,
    headers: created.headers,
  });
}

/** Создать запись на сервере и начать её в .app. */
export async function startRecording(
  applicationId: string,
  interviewId: string,
): Promise<CreatedRecording> {
  const created = await createRecording(applicationId, interviewId);
  await resumeRecording(created);
  return created;
}

/** Остановить в .app и закрыть запись на сервере: дальше идёт расшифровка. */
export async function stopRecording(recordingId: string): Promise<void> {
  const result = (await invokeDesktopCommand<StopResult>('recording_stop')) ?? {
    segments: 0,
    failed: 0,
  };
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
