import { describe, expect, it } from 'vitest';
import type { DebriefMetrics } from '../../../../../server/domain/interviewDebrief';
import {
  clock,
  debriefLeadSub,
  durationText,
  measuresTip,
  shareParts,
  speakerLabel,
} from './debriefModel';

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

  it('durationText: короткое — секундами, до 10 минут — минуты и секунды, дольше — минуты', () => {
    expect(durationText(3_000)).toBe('3\u00a0с');
    expect(durationText(80_000)).toBe('1\u00a0мин 20\u00a0с');
    expect(durationText(120_000)).toBe('2\u00a0мин');
    expect(durationText(58 * 60_000)).toBe('58 минут');
  });

  it('debriefLeadSub: компания · день интервью · с кем', () => {
    expect(
      debriefLeadSub({
        company: 'Арка Холдинг',
        scheduledAt: '2026-11-12T12:00:00.000Z',
        format: 'с техническим директором',
        interviewerName: null,
        timeZone: 'Europe/Moscow',
      }),
    ).toBe('Арка Холдинг · интервью 12 ноября · с техническим директором');
    expect(
      debriefLeadSub({
        company: '',
        scheduledAt: null,
        format: null,
        interviewerName: 'Ирина Петрова',
      }),
    ).toBe('собеседник: Ирина Петрова');
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
