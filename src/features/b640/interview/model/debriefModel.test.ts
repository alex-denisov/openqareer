import { describe, expect, it } from 'vitest';
import type { DebriefMetrics } from '../../../../../server/domain/interviewDebrief';
import { clock, durationText, measuresTip, shareParts, speakerLabel } from './debriefModel';

const VOICED: DebriefMetrics = {
  durationMs: 58 * 60_000,
  candidateShare: 58,
  interviewerShare: 42,
  wordsPerMinute: 135,
  longPauses: 3,
};

describe('debriefModel', () => {
  it('clock: минуты и секунды, после часа — с часами', () => {
    expect(clock(252_000)).toBe('04:12');
    expect(clock(3_725_000)).toBe('1:02:05');
  });

  it('durationText: «58 минут», «1 минута»', () => {
    expect(durationText(58 * 60_000)).toBe('58 минут');
    expect(durationText(61_000)).toBe('1 минута');
  });

  it('two voices: share, interviewer, tempo and pauses as in the mockup', () => {
    expect(shareParts(VOICED)).toEqual({ candidate: 58, interviewer: 42, tempo: 135, pauses: 3 });
  });

  it('uploaded file: no share at all, tempo and pauses stay', () => {
    const upload = { ...VOICED, candidateShare: null, interviewerShare: null };
    expect(shareParts(upload)).toEqual({
      candidate: null,
      interviewer: null,
      tempo: 135,
      pauses: 3,
    });
  });

  it('measures tip names the date, length and whether voices are split', () => {
    expect(measuresTip('2026-11-12T12:00:00Z', VOICED, true)).toBe(
      'Считаем по расшифровке записи от 12 ноября, 58 минут, два голоса. Только слова, паузы и темп; настроение по голосу не оцениваем.',
    );
    expect(measuresTip('2026-11-12T12:00:00Z', VOICED, false)).toContain('голоса не разделены');
  });

  it('speaker label uses the interviewer name from the upload when there is one', () => {
    expect(speakerLabel('interviewer', 'Сергей Минин')).toBe('Сергей Минин');
    expect(speakerLabel('interviewer', null)).toBe('Интервьюер');
    expect(speakerLabel('candidate', null)).toBe('Вы');
    expect(speakerLabel(null, 'Сергей Минин')).toBeNull();
  });
});
