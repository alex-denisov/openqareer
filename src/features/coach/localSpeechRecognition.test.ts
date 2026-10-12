import { describe, expect, it, vi } from 'vitest';
import {
  createLocalSpeechRecognition,
  combineSpeechResults,
  mapLocalSpeechError,
  type LocalSpeechRecognition,
  type SpeechRecognitionScope,
} from './localSpeechRecognition';

class FakeRecognition implements LocalSpeechRecognition {
  processLocally = false;
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: LocalSpeechRecognition['onresult'] = null;
  onerror: LocalSpeechRecognition['onerror'] = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

function speechScope(
  availability: 'available' | 'downloadable' | 'downloading' | 'unavailable',
) {
  const Constructor = Object.assign(vi.fn(function createFakeRecognition() {
    return new FakeRecognition();
  }), {
    available: vi.fn().mockResolvedValue(availability),
  }) as unknown as typeof FakeRecognition & { available: ReturnType<typeof vi.fn> };
  return {
    scope: { SpeechRecognition: Constructor } as unknown as SpeechRecognitionScope,
    Constructor,
  };
}

describe('local speech recognition adapter', () => {
  it('uses only the standard API and refuses browsers without local capability checks', async () => {
    const scope = {
      webkitSpeechRecognition: FakeRecognition,
    } as unknown as SpeechRecognitionScope;

    await expect(createLocalSpeechRecognition(scope)).resolves.toBeNull();
  });

  it('does not construct a recognizer when the local language pack is unavailable', async () => {
    const { scope, Constructor } = speechScope('downloadable');

    await expect(createLocalSpeechRecognition(scope)).resolves.toBeNull();
    expect(Constructor).not.toHaveBeenCalled();
    expect(Constructor.available).toHaveBeenCalledWith({
      langs: ['ru-RU'],
      processLocally: true,
      quality: 'dictation',
    });
  });

  it('requires local processing before the recognizer can start', async () => {
    const { scope, Constructor } = speechScope('available');

    const recognizer = await createLocalSpeechRecognition(scope);

    expect(recognizer).toBeInstanceOf(FakeRecognition);
    expect(recognizer?.processLocally).toBe(true);
    expect(recognizer?.lang).toBe('ru-RU');
    expect(recognizer?.continuous).toBe(true);
    expect(recognizer?.interimResults).toBe(true);
    expect(Constructor.available).toHaveBeenCalledOnce();
  });

  it('maps permission, no-speech, unsupported and service errors without exposing provider messages', () => {
    expect(mapLocalSpeechError('not-allowed')).toBe('denied');
    expect(mapLocalSpeechError('audio-capture')).toBe('denied');
    expect(mapLocalSpeechError('no-speech')).toBe('unrecognized');
    expect(mapLocalSpeechError('language-not-supported')).toBe('unsupported');
    expect(mapLocalSpeechError('service-not-allowed')).toBe('unsupported');
    expect(mapLocalSpeechError('network')).toBe('error');
    expect(mapLocalSpeechError('aborted')).toBe('cancelled');
  });

  it('combines final and interim chunks with the existing text without losing word boundaries', () => {
    const results = [
      { isFinal: true, 0: { transcript: 'Сначала я собрал команду ' } },
      { isFinal: false, 0: { transcript: 'и объяснил риски' } },
    ];

    expect(combineSpeechResults(results, 'Предыдущий ответ')).toBe(
      'Предыдущий ответ Сначала я собрал команду и объяснил риски',
    );
  });
});
