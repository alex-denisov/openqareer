import { describe, expect, it } from 'vitest';
import {
  advanceReferral,
  buildReferralPitch,
  newReferralTrack,
  pitchViolations,
  type ReferralPitchInput,
} from './referralTrack';

const input: ReferralPitchInput = {
  candidateName: 'Алексей',
  targetRole: 'Руководитель разработки',
  company: 'Acme',
  contactName: 'Мария',
  basis: { kind: 'shared_community', detail: 'сообщество Product Engineering' },
  facts: ['10 лет в разработке платёжных сервисов', 'руководил командой из 14 человек'],
};

const at = '2026-10-06T10:00:00.000Z';

describe('buildReferralPitch', () => {
  it('называет реальную основу знакомства и не утверждает совместной работы', () => {
    const pitch = buildReferralPitch(input);
    expect(pitch).toContain('сообщество Product Engineering');
    expect(pitch).toContain('Руководитель разработки');
    expect(pitchViolations(pitch)).toEqual([]);
  });

  it('без общей основы честно говорит, что человек незнаком', () => {
    const pitch = buildReferralPitch({ ...input, basis: { kind: 'none' } });
    expect(pitch).toMatch(/мы не знакомы/iu);
    expect(pitchViolations(pitch)).toEqual([]);
  });

  it('оставляет собеседнику право отказаться', () => {
    expect(buildReferralPitch(input)).toMatch(/неудобно|откажете/iu);
  });
});

describe('pitchViolations', () => {
  it.each([
    ['Мы лично работали вместе в Acme', 'false_acquaintance'],
    ['Это моя последняя надежда, помогите срочно', 'pressure'],
    ['Вы просто обязаны меня порекомендовать', 'pressure'],
  ])('находит нарушение в «%s»', (text, kind) => {
    expect(pitchViolations(text)).toContain(kind);
  });
});

describe('advanceReferral', () => {
  it('идёт по пути выбран → питч → запрос отправлен кандидатом → ответ', () => {
    let track = newReferralTrack('c1', at);
    track = advanceReferral(track, { type: 'draft_pitch', pitch: 'текст' }, at);
    expect(track.status).toBe('pitch_ready');
    track = advanceReferral(track, { type: 'candidate_sent_request' }, at);
    expect(track.status).toBe('request_sent');
    expect(track.sentByCandidateAt).toBe(at);
    track = advanceReferral(track, { type: 'record_reply', outcome: 'positive' }, at);
    expect(track.status).toBe('replied_positive');
  });

  it('не отправляет запрос без питча', () => {
    const track = newReferralTrack('c1', at);
    expect(() => advanceReferral(track, { type: 'candidate_sent_request' }, at)).toThrow();
  });

  it('не принимает ответ, пока запрос не отправлен', () => {
    const track = advanceReferral(
      newReferralTrack('c1', at),
      { type: 'draft_pitch', pitch: 'п' },
      at,
    );
    expect(() =>
      advanceReferral(track, { type: 'record_reply', outcome: 'declined' }, at),
    ).toThrow();
  });

  it('питч с давлением не сохраняется', () => {
    expect(() =>
      advanceReferral(
        newReferralTrack('c1', at),
        { type: 'draft_pitch', pitch: 'Помогите срочно, последний шанс' },
        at,
      ),
    ).toThrow();
  });

  it('возвращает новый объект и не меняет прежний', () => {
    const first = newReferralTrack('c1', at);
    const next = advanceReferral(first, { type: 'draft_pitch', pitch: 'п' }, at);
    expect(first.status).toBe('selected');
    expect(next).not.toBe(first);
  });

  it('молчание фиксируется как «без ответа» только после отправки', () => {
    let track = advanceReferral(
      newReferralTrack('c1', at),
      { type: 'draft_pitch', pitch: 'п' },
      at,
    );
    track = advanceReferral(track, { type: 'candidate_sent_request' }, at);
    expect(advanceReferral(track, { type: 'mark_no_reply' }, at).status).toBe('no_reply');
  });
});
