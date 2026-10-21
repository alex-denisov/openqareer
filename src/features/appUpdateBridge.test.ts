import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  channels: [] as Array<{ onmessage?: (event: unknown) => void }>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
  Channel: class {
    onmessage?: (event: unknown) => void;

    constructor() {
      mocks.channels.push(this);
    }
  },
  Resource: class {
    readonly rid: number;

    constructor(rid: number) {
      this.rid = rid;
    }

    async close() {
      await mocks.invoke('plugin:resources|close', { rid: this.rid });
    }
  },
}));

import {
  checkForUpdate,
  downloadAndInstall,
  relaunch,
  SignatureVerificationError,
} from './appUpdate/appUpdateBridge';

const updateMetadata = {
  rid: 7,
  currentVersion: '1.0.0',
  version: '1.0.1',
  date: '2026-10-21T00:00:00.000Z',
  body: 'Улучшения и исправления',
  rawJson: {},
};

afterEach(() => {
  mocks.invoke.mockReset();
  mocks.isTauri.mockReset().mockReturnValue(true);
  mocks.channels.length = 0;
});

describe('appUpdateBridge', () => {
  it('returns a clear unavailable result outside Tauri', async () => {
    mocks.isTauri.mockReturnValue(false);

    await expect(checkForUpdate()).resolves.toEqual({ status: 'unavailable_in_web' });
    await expect(downloadAndInstall(() => undefined)).resolves.toEqual({ status: 'unavailable_in_web' });
    await expect(relaunch()).resolves.toEqual({ status: 'unavailable_in_web' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('reports an available update and an up-to-date installation', async () => {
    mocks.invoke
      .mockResolvedValueOnce(updateMetadata)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(null);

    await expect(checkForUpdate()).resolves.toEqual({
      status: 'available',
      version: '1.0.1',
      currentVersion: '1.0.0',
      date: '2026-10-21T00:00:00.000Z',
      notes: 'Улучшения и исправления',
    });
    await expect(checkForUpdate()).resolves.toEqual({ status: 'up_to_date' });
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'plugin:updater|check',
      'plugin:resources|close',
      'plugin:updater|check',
    ]);
  });

  it('passes progress events through while downloading and installing', async () => {
    const progress: number[] = [];
    mocks.invoke
      .mockResolvedValueOnce(updateMetadata)
      .mockImplementationOnce(async (_command: string, args: { onEvent: { onmessage?: (event: unknown) => void } }) => {
        args.onEvent.onmessage?.({ event: 'Started', data: { contentLength: 100 } });
        args.onEvent.onmessage?.({ event: 'Progress', data: { chunkLength: 40 } });
        args.onEvent.onmessage?.({ event: 'Finished' });
      });
    await checkForUpdate();

    await expect(downloadAndInstall((event) => progress.push(event.progressPercent))).resolves.toEqual({
      status: 'installed',
    });
    expect(progress).toEqual([0, 40, 100]);
    expect(mocks.invoke.mock.calls[1]?.[0]).toBe('plugin:updater|download_and_install');
  });

  it('distinguishes signature failure and never requests a relaunch after it', async () => {
    mocks.invoke
      .mockResolvedValueOnce(updateMetadata)
      .mockRejectedValueOnce(new Error('failed to verify update signature'));
    await checkForUpdate();

    await expect(downloadAndInstall(() => undefined)).rejects.toBeInstanceOf(
      SignatureVerificationError,
    );
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'plugin:process|restart')).toBe(false);
  });

  it('surfaces network errors from update checks', async () => {
    mocks.invoke.mockRejectedValueOnce(new TypeError('network unavailable'));

    await expect(checkForUpdate()).rejects.toThrow('network unavailable');
  });

  it('uses the process plugin to relaunch after an installed update', async () => {
    await relaunch();

    expect(mocks.invoke).toHaveBeenCalledWith('plugin:process|restart');
  });
});
