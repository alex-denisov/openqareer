import { describe, expect, it } from 'vitest';
import type { DebriefLine } from './interviewDebrief';
import { acceptVoiceChanges, applyVoices, voiceInputText, voiceSummary } from './interviewVoices';

const line = (startMs: number, endMs: number, text: string): DebriefLine => ({
  speaker: null,
  startMs,
  endMs,
  text,
});

const LINES = [
  line(0, 4_000, 'Расскажите, как устроена ваша платформа.'),
  line(4_000, 14_000, 'Мы переводили платформу на Kubernetes в 2024 году.'),
  line(14_000, 20_000, 'Сколько сервисов перенесли?'),
  line(20_000, 30_000, 'Около сорока, за полгода.'),
];

describe('voiceInputText: строки с номерами для модели', () => {
  it('номер строки, время и текст', () => {
    expect(voiceInputText(LINES).split('\n')[1]).toBe(
      '1 [00:04] Мы переводили платформу на Kubernetes в 2024 году.',
    );
  });
});

describe('acceptVoiceChanges: смены голоса из ответа модели', () => {
  it('разворачивает смены в голос каждой строки', () => {
    const raw = {
      changes: [
        { line: 0, voice: 2 },
        { line: 1, voice: 1 },
        { line: 2, voice: 2 },
        { line: 3, voice: 1 },
      ],
    };
    expect(acceptVoiceChanges(raw, 4)).toEqual([2, 1, 2, 1]);
  });

  it('без смены с первой строки, с номером вне расшифровки или одним голосом — отказ', () => {
    expect(acceptVoiceChanges({ changes: [{ line: 1, voice: 1 }] }, 4)).toBeNull();
    expect(
      acceptVoiceChanges(
        {
          changes: [
            { line: 0, voice: 1 },
            { line: 9, voice: 2 },
          ],
        },
        4,
      ),
    ).toBeNull();
    expect(acceptVoiceChanges({ changes: [{ line: 0, voice: 1 }] }, 4)).toBeNull();
    expect(
      acceptVoiceChanges(
        {
          changes: [
            { line: 0, voice: 3 },
            { line: 1, voice: 1 },
          ],
        },
        4,
      ),
    ).toBeNull();
    expect(acceptVoiceChanges('мусор', 4)).toBeNull();
  });

  it('смены не по порядку сортируются', () => {
    const raw = {
      changes: [
        { line: 2, voice: 1 },
        { line: 0, voice: 2 },
      ],
    };
    expect(acceptVoiceChanges(raw, 4)).toEqual([2, 2, 1, 1]);
  });
});

describe('voiceSummary: доля речи и цитата каждого голоса', () => {
  it('доля по времени, цитата — самая длинная реплика, укорочена', () => {
    const summary = voiceSummary(LINES, [2, 1, 2, 1]);
    expect(summary.map((voice) => [voice.voice, voice.sharePercent])).toEqual([
      [1, 67],
      [2, 33],
    ]);
    expect(summary[0]!.quote).toBe('Мы переводили платформу на Kubernetes в 2024 году.');
    expect(summary[1]!.quote).toBe('Расскажите, как устроена ваша платформа.');
  });
});

describe('applyVoices: голос кандидата → говорящие', () => {
  it('голос кандидата — «candidate», второй — «interviewer»', () => {
    expect(applyVoices(LINES, [2, 1, 2, 1], 1).map((l) => l.speaker)).toEqual([
      'interviewer',
      'candidate',
      'interviewer',
      'candidate',
    ]);
  });

  it('метки не сходятся со строками — строки без говорящих', () => {
    expect(applyVoices(LINES, [1, 2], 1)).toEqual(LINES);
  });
});
