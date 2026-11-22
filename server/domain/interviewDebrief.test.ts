import { describe, expect, it } from 'vitest';
import {
  acceptDebrief,
  debriefMetrics,
  debriefTranscriptText,
  type DebriefLine,
} from './interviewDebrief';

const LINES: readonly DebriefLine[] = [
  {
    speaker: 'interviewer',
    startMs: 0,
    endMs: 4_000,
    text: 'Как переводили платформу на Kubernetes?',
  },
  {
    speaker: 'candidate',
    startMs: 5_000,
    endMs: 65_000,
    text: 'В 2024 году мы перевели сорок сервисов без простоя, релизы стали еженедельными.',
  },
  {
    speaker: 'interviewer',
    startMs: 70_000,
    endMs: 74_000,
    text: 'Как растили руководителей групп?',
  },
  {
    speaker: 'candidate',
    startMs: 75_000,
    endMs: 95_000,
    text: 'Ну, по-разному, давали людям расти.',
  },
  {
    speaker: 'interviewer',
    startMs: 96_000,
    endMs: 100_000,
    text: 'Следующий шаг — встреча с CTO.',
  },
];

describe('debriefMetrics', () => {
  it('two voices: speech share, candidate tempo and pauses longer than 3 s', () => {
    const metrics = debriefMetrics(LINES);
    expect(metrics.durationMs).toBe(100_000);
    expect(metrics.candidateShare).toBe(87);
    expect(metrics.interviewerShare).toBe(13);
    expect(metrics.wordsPerMinute).toBe(13);
    expect(metrics.longPauses).toBe(1);
  });

  it('an uploaded file has no voices: no share, tempo over all speech', () => {
    const metrics = debriefMetrics(LINES.map((line) => ({ ...line, speaker: null })));
    expect(metrics.candidateShare).toBeNull();
    expect(metrics.interviewerShare).toBeNull();
    expect(metrics.wordsPerMinute).toBeGreaterThan(0);
  });

  it('an empty transcript gives zeros, not NaN', () => {
    expect(debriefMetrics([])).toEqual({
      durationMs: 0,
      candidateShare: null,
      interviewerShare: null,
      wordsPerMinute: 0,
      longPauses: 0,
    });
  });
});

describe('debriefTranscriptText', () => {
  it('caps the model input and keeps timestamps', () => {
    const text = debriefTranscriptText(LINES, 120);
    expect(text.startsWith('[00:00] Интервьюер: Как переводили')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(120);
  });
});

describe('acceptDebrief', () => {
  const raw = {
    questions: [
      {
        atMs: 0,
        question: 'Как переводили платформу на Kubernetes?',
        summary: 'Ответили примером 2024 года',
        prepared: true,
        quote: 'мы перевели сорок сервисов без простоя',
        fix: null,
      },
      {
        atMs: 70_000,
        question: 'Как растили руководителей групп?',
        summary: 'Ответили общими словами',
        prepared: true,
        quote: 'мы вырастили пятерых тимлидов',
        fix: 'добавить пример роста человека до руководителя',
      },
    ],
    agreements: [
      { atMs: 96_000, text: 'Следующий шаг — встреча с CTO', quote: 'встреча с CTO' },
      { atMs: 50_000, text: 'Оффер до пятницы', quote: 'оффер до пятницы' },
    ],
  };

  it('«было готово» only with a quote from the transcript; an invented one becomes «нужен ответ»', () => {
    const debrief = acceptDebrief(raw, LINES);
    expect(debrief?.questions.map((item) => item.prepared)).toEqual([true, false]);
    expect(debrief?.questions[1]?.quote).toBeNull();
  });

  it('drops agreements whose quote is not in the transcript', () => {
    expect(acceptDebrief(raw, LINES)?.agreements.map((item) => item.text)).toEqual([
      'Следующий шаг — встреча с CTO',
    ]);
  });

  it('pins a question time to a real line and lists what to prepare next', () => {
    const debrief = acceptDebrief(
      { ...raw, questions: [{ ...raw.questions[1], atMs: 71_500 }] },
      LINES,
    );
    expect(debrief?.questions[0]?.atMs).toBe(70_000);
    expect(debrief?.nextPrep).toEqual(['добавить пример роста человека до руководителя']);
  });

  it('rejects a malformed answer', () => {
    expect(acceptDebrief({ questions: 'нет' }, LINES)).toBeNull();
    expect(acceptDebrief(null, LINES)).toBeNull();
  });
});
