// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../kit/testDom';
import { useVoiceInput, type VoiceInput } from './useVoiceInput';

const bridge = vi.hoisted(() => ({
  canRecordInApp: vi.fn(),
  recordingPermissions: vi.fn(),
  requestRecordingPermissions: vi.fn(),
}));
vi.mock('../interview/data/recordingBridge', () => bridge);
const dictation = vi.hoisted(() => ({
  beginAppDictation: vi.fn(),
  finishAppDictation: vi.fn(),
}));
vi.mock('./appDictation', () => dictation);
vi.mock('../consultant/useDictation', () => ({
  speechSupported: () => false,
  useDictation: () => ({
    supported: false,
    recording: false,
    settling: false,
    denied: false,
    start: () => undefined,
    stop: () => undefined,
  }),
}));

const CREATED = { recordingId: 'dict-1', uploadUrl: 'https://x/segments', headers: {} };
let view: Mounted | null = null;
let current: VoiceInput | null = null;
const texts: string[] = [];

function Probe() {
  current = useVoiceInput((text) => texts.push(text));
  return null;
}

async function render() {
  await act(async () => {
    view = mount(<Probe />);
  });
  return () => current as VoiceInput;
}

beforeEach(() => {
  texts.length = 0;
  vi.clearAllMocks();
  bridge.canRecordInApp.mockReturnValue(true);
  bridge.recordingPermissions.mockResolvedValue({
    supported: true,
    microphone: true,
    screen: false,
  });
  bridge.requestRecordingPermissions.mockResolvedValue({
    supported: true,
    microphone: true,
    screen: false,
  });
  dictation.beginAppDictation.mockResolvedValue(CREATED);
  dictation.finishAppDictation.mockResolvedValue('перенесли кластеры');
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('голосовой ввод в .app без распознавания речи браузером', () => {
  it('до B758 голос в .app не предлагается: запись взяла бы звук компьютера', async () => {
    const state = await render();
    expect(state().supported).toBe(false);
    expect(bridge.recordingPermissions).not.toHaveBeenCalled();
  });

  it('запись с микрофона, после «Стоп» текст дописывается к полю', async () => {
    const state = await render();
    await act(async () => state().start('Мы'));
    expect(state().recording).toBe(true);
    await act(async () => state().stop());
    expect(dictation.finishAppDictation).toHaveBeenCalledWith('dict-1', expect.any(AbortSignal));
    expect(texts).toEqual(['Мы перенесли кластеры']);
    expect([state().recording, state().settling, state().failure]).toEqual([false, false, null]);
  });

  it('нет доступа к микрофону — «mic», запись не создаётся', async () => {
    bridge.requestRecordingPermissions.mockResolvedValue({
      supported: true,
      microphone: false,
      screen: false,
    });
    const state = await render();
    await act(async () => state().start(''));
    expect(state().failure).toBe('mic');
    expect(state().denied).toBe(true);
    expect(dictation.beginAppDictation).not.toHaveBeenCalled();
  });

  it('не распозналось — «speech», текст поля не трогается', async () => {
    dictation.finishAppDictation.mockRejectedValue(new Error('speech_empty'));
    const state = await render();
    await act(async () => state().start('Мы'));
    await act(async () => state().stop());
    expect(state().failure).toBe('speech');
    expect(texts).toEqual([]);
  });

  it('вне .app голосового ввода нет', async () => {
    bridge.canRecordInApp.mockReturnValue(false);
    const state = await render();
    expect(state().supported).toBe(false);
  });
});
