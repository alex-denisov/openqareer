import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finishAppDictation } from './appDictation';

const api = vi.hoisted(() => ({ apiFetch: vi.fn(), readDataObject: vi.fn() }));
vi.mock('../../coach/apiClient', () => api);
const bridge = vi.hoisted(() => ({ launchRecording: vi.fn(), stopRecording: vi.fn() }));
vi.mock('../interview/data/recordingBridge', () => bridge);

const views = (...items: object[]) => {
  for (const item of items) api.readDataObject.mockResolvedValueOnce(item);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  api.apiFetch.mockResolvedValue(new Response('{}'));
  bridge.stopRecording.mockResolvedValue(undefined);
});

describe('диктовка .app: текст после расшифровки, запись удаляется', () => {
  it('ждёт расшифровку и склеивает реплики', async () => {
    views(
      { status: 'transcribing', transcript: null },
      { status: 'ready', transcript: [{ text: 'Мы перенесли' }, { text: 'кластеры.' }] },
    );
    const text = finishAppDictation('d-1', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(text).resolves.toBe('Мы перенесли кластеры.');
    expect(bridge.stopRecording).toHaveBeenCalledWith('d-1');
    expect(api.apiFetch).toHaveBeenLastCalledWith('/api/v1/candidate/recordings/d-1', {
      method: 'DELETE',
    });
  });

  it('пустая речь и сбой расшифровки — ошибка, запись всё равно удаляется', async () => {
    views({ status: 'ready', transcript: [] });
    await expect(finishAppDictation('d-2', new AbortController().signal)).rejects.toThrow(
      'speech_empty',
    );
    views({ status: 'failed', transcript: null });
    await expect(finishAppDictation('d-3', new AbortController().signal)).rejects.toThrow(
      'transcription_failed',
    );
    const deleted = api.apiFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleted.map(([path]) => path)).toEqual([
      '/api/v1/candidate/recordings/d-2',
      '/api/v1/candidate/recordings/d-3',
    ]);
  });
});
