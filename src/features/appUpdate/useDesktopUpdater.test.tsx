// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('./appUpdateBridge', async (original) => ({
  ...(await original<typeof import('./appUpdateBridge')>()),
  ...bridge,
}));

import { SignatureVerificationError } from './appUpdateBridge';
import { UPDATE_CHECK_DELAY_MS, createDesktopUpdater, useDesktopUpdater } from './useDesktopUpdater';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function launched(autoInstall = false) {
  const result = { current: null as unknown as ReturnType<typeof useDesktopUpdater> };
  const updater = createDesktopUpdater();
  updater.setAutoInstall(autoInstall);
  updater.start();
  function Probe() {
    result.current = useDesktopUpdater(updater);
    return null;
  }
  await act(async () => createRoot(document.createElement('div')).render(<Probe />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);
  });
  return { result };
}

describe('useDesktopUpdater', () => {
  it('B771: a check says what it found — latest, available or failed', async () => {
    const updater = createDesktopUpdater();
    bridge.checkForUpdate.mockResolvedValueOnce({ status: 'up_to_date' });
    await expect(updater.check()).resolves.toBe('latest');
    bridge.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    await expect(updater.check()).resolves.toBe('failed');
    expect(updater.getStatus().state).toBe('idle');
    bridge.checkForUpdate.mockResolvedValueOnce({ status: 'available', version: '1.1.196', currentVersion: '1.1.195' });
    await expect(updater.check()).resolves.toBe('available');
    await expect(updater.check()).resolves.toBe('busy');
  });

  it('stays idle when the installation is current', async () => {
    bridge.checkForUpdate.mockResolvedValue({ status: 'up_to_date' });
    const { result } = await launched();
    expect(bridge.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.status.state).toBe('idle');
  });

  it('offers a found update, installs it with progress and relaunches', async () => {
    bridge.checkForUpdate.mockResolvedValue({
      status: 'available', version: '1.0.2', currentVersion: '1.0.1', notes: 'Исправления',
    });
    bridge.downloadAndInstall.mockImplementation(async (onProgress: (p: unknown) => void) => {
      onProgress({ downloadedBytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024, progressPercent: 50 });
      return { status: 'installed' };
    });
    const { result } = await launched();
    expect(result.current.status.state).toBe('available');
    expect(result.current.status.info).toMatchObject({ version: '1.0.2', currentVersion: '1.0.1' });
    await act(async () => result.current.actions.onInstall());
    expect(result.current.status).toMatchObject({ state: 'ready', modal: 'none' });
    expect(result.current.status.info.progressPercent).toBe(50);
    act(() => result.current.actions.onRestart());
    expect(bridge.relaunch).toHaveBeenCalledTimes(1);
  });

  it('reports a failed signature and never relaunches', async () => {
    bridge.checkForUpdate.mockResolvedValue({ status: 'available', version: '1.0.2', currentVersion: '1.0.1' });
    bridge.downloadAndInstall.mockRejectedValue(new SignatureVerificationError());
    const { result } = await launched();
    await act(async () => result.current.actions.onInstall());
    expect(result.current.status).toMatchObject({ state: 'error', modal: 'none' });
    expect(result.current.status.errorMessage).toMatch(/Подпись/u);
    expect(bridge.relaunch).not.toHaveBeenCalled();
  });

  it('B722: with automatic updates on, a found update downloads by itself and waits for a restart', async () => {
    bridge.checkForUpdate.mockResolvedValue({ status: 'available', version: '1.0.2', currentVersion: '1.0.1' });
    bridge.downloadAndInstall.mockResolvedValue({ status: 'installed' });
    const { result } = await launched(true);
    expect(bridge.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(result.current.status).toMatchObject({ state: 'ready', modal: 'none' });
    expect(bridge.relaunch).not.toHaveBeenCalled();
  });

  it('B722: with automatic updates off, a found update only waits for the candidate', async () => {
    bridge.checkForUpdate.mockResolvedValue({ status: 'available', version: '1.0.2', currentVersion: '1.0.1' });
    const { result } = await launched(false);
    expect(bridge.downloadAndInstall).not.toHaveBeenCalled();
    expect(result.current.status.state).toBe('available');
  });

  it('keeps quiet when the feed is unreachable', async () => {
    bridge.checkForUpdate.mockRejectedValue(new Error('network'));
    const { result } = await launched();
    expect(result.current.status.state).toBe('idle');
  });
});
