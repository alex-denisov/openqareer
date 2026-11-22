// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import type { RecordingStateEvent } from './data/recordingBridge';
import { useAppRecording, type AppRecording } from './useAppRecording';

const bridge = vi.hoisted(() => ({
  recordingPermissions: vi.fn(),
  requestRecordingPermissions: vi.fn(),
  startRecording: vi.fn(),
  resumeRecording: vi.fn(),
  stopRecording: vi.fn(),
  onRecordingState: vi.fn(),
  startErrorText: (error: unknown) => `ошибка: ${String((error as Error).message)}`,
}));
vi.mock('./data/recordingBridge', () => bridge);

const CREATED = {
  recordingId: 'rec-1',
  uploadUrl: 'https://x/segments',
  headers: { 'X-Recording-Token': 't' },
};
let view: Mounted | null = null;
let current: AppRecording | null = null;
let emit: (event: RecordingStateEvent) => void = () => undefined;

function Probe({ interviewId }: { readonly interviewId: string | null }) {
  current = useAppRecording('app-1', interviewId);
  return null;
}

async function render(interviewId: string | null = 'iv-1') {
  await act(async () => {
    view = mount(<Probe interviewId={interviewId} />);
  });
  return () => current as AppRecording;
}

beforeEach(() => {
  bridge.recordingPermissions.mockResolvedValue({
    supported: true,
    microphone: false,
    screen: false,
  });
  bridge.requestRecordingPermissions.mockResolvedValue({
    supported: true,
    microphone: true,
    screen: true,
  });
  bridge.startRecording.mockResolvedValue(CREATED);
  bridge.resumeRecording.mockResolvedValue({ ...CREATED, recordingId: 'rec-2' });
  bridge.stopRecording.mockResolvedValue(undefined);
  bridge.onRecordingState.mockImplementation(
    async (handler: (event: RecordingStateEvent) => void) => {
      emit = handler;
      return () => undefined;
    },
  );
});
afterEach(() => {
  view?.unmount();
  vi.clearAllMocks();
});

describe('useAppRecording (I4b)', () => {
  it('outside a supporting .app it offers nothing to record', async () => {
    bridge.recordingPermissions.mockResolvedValue({
      supported: false,
      microphone: false,
      screen: false,
    });
    const state = await render();
    expect(state().phase).toBe('unsupported');
  });

  it('start asks for permissions, creates the recording and follows elapsed time', async () => {
    const state = await render();
    expect(state().phase).toBe('ready');
    await act(() => state().start());
    expect(bridge.startRecording).toHaveBeenCalledWith('app-1', 'iv-1');
    expect(state().phase).toBe('recording');
    act(() => emit({ state: 'recording', elapsedMs: 83_000 }));
    expect(state().elapsedMs).toBe(83_000);
  });

  it('a denied microphone keeps the start button with a line about it', async () => {
    bridge.requestRecordingPermissions.mockResolvedValue({
      supported: true,
      microphone: false,
      screen: true,
    });
    const state = await render();
    await act(() => state().start());
    expect(state().phase).toBe('ready');
    expect(state().error).toBe('ошибка: microphone_permission');
    expect(bridge.startRecording).not.toHaveBeenCalled();
  });

  it('a break mid-call: the next part continues the recording, stop closes it', async () => {
    const state = await render();
    await act(() => state().start());
    act(() => emit({ state: 'error', elapsedMs: 23 * 60_000, error: 'capture' }));
    expect(state().phase).toBe('stopped');
    await act(() => state().resume());
    expect(bridge.resumeRecording).toHaveBeenCalledWith('app-1', 'iv-1', CREATED);
    await act(() => state().stop());
    expect(bridge.stopRecording).toHaveBeenCalledWith('rec-2');
    expect(state().phase).toBe('done');
  });
});
