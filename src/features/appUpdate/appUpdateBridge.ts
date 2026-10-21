import { Channel, Resource, invoke, isTauri } from '@tauri-apps/api/core';

// The Rust plugins are registered, but their guest npm packages are not in this lockfile.

interface UpdateMetadata {
  readonly rid: number;
  readonly currentVersion: string;
  readonly version: string;
  readonly date?: string;
  readonly body?: string;
}

type DownloadEvent =
  | { readonly event: 'Started'; readonly data: { readonly contentLength?: number } }
  | { readonly event: 'Progress'; readonly data: { readonly chunkLength: number } }
  | { readonly event: 'Finished' };

export interface UpdateProgress {
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly progressPercent: number;
}

export type UpdateCheckResult =
  | { readonly status: 'unavailable_in_web' }
  | { readonly status: 'up_to_date' }
  | {
      readonly status: 'available';
      readonly version: string;
      readonly currentVersion: string;
      readonly date?: string;
      readonly notes?: string;
    };

export type UpdateActionResult =
  | { readonly status: 'unavailable_in_web' }
  | { readonly status: 'no_update_available' }
  | { readonly status: 'installed' }
  | { readonly status: 'relaunching' };

export class SignatureVerificationError extends Error {
  constructor() {
    super('Подпись обновления не прошла проверку. Установка отменена.');
    this.name = 'SignatureVerificationError';
  }
}

let pendingUpdate: UpdateMetadata | null = null;
let pendingResource: Resource | null = null;

export function isTauriEnvironment(): boolean {
  return isTauri();
}

async function closePendingUpdate(): Promise<void> {
  const resource = pendingResource;
  pendingUpdate = null;
  pendingResource = null;
  await resource?.close();
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriEnvironment()) return { status: 'unavailable_in_web' };
  await closePendingUpdate();
  const update = await invoke<UpdateMetadata | null>('plugin:updater|check', {});
  if (!update) return { status: 'up_to_date' };
  pendingUpdate = update;
  pendingResource = new Resource(update.rid);
  return {
    status: 'available',
    version: update.version,
    currentVersion: update.currentVersion,
    ...(update.date ? { date: update.date } : {}),
    ...(update.body ? { notes: update.body } : {}),
  };
}

function progressPercent(downloadedBytes: number, totalBytes: number | null): number {
  if (totalBytes === null || totalBytes <= 0) return 0;
  return Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

export async function downloadAndInstall(
  onProgress: (progress: UpdateProgress) => void,
): Promise<UpdateActionResult> {
  if (!isTauriEnvironment()) return { status: 'unavailable_in_web' };
  const update = pendingUpdate;
  const resource = pendingResource;
  if (!update) return { status: 'no_update_available' };

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  const onEvent = new Channel<DownloadEvent>();
  onEvent.onmessage = (event) => {
    if (event.event === 'Started') totalBytes = event.data.contentLength ?? null;
    if (event.event === 'Progress') downloadedBytes += event.data.chunkLength;
    if (event.event === 'Finished' && totalBytes !== null) downloadedBytes = totalBytes;
    onProgress({
      downloadedBytes,
      totalBytes,
      progressPercent: event.event === 'Finished' ? 100 : progressPercent(downloadedBytes, totalBytes),
    });
  };

  try {
    await invoke<void>('plugin:updater|download_and_install', { rid: update.rid, onEvent });
    pendingUpdate = null;
    pendingResource = null;
    return { status: 'installed' };
  } catch (error: unknown) {
    pendingUpdate = null;
    pendingResource = null;
    await resource?.close().catch(() => undefined);
    if (/signature|public key/iu.test(messageOf(error))) throw new SignatureVerificationError();
    throw error;
  }
}

export async function relaunch(): Promise<UpdateActionResult> {
  if (!isTauriEnvironment()) return { status: 'unavailable_in_web' };
  await invoke<void>('plugin:process|restart');
  return { status: 'relaunching' };
}
