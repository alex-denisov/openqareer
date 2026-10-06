/**
 * Трек внутренней рекомендации (B389): выбран → питч → запрос отправлен
 * кандидатом → ответ. Продукт ничего не отправляет сам: отправку фиксирует
 * только действие кандидата. Текст не просит выдавать знакомство за
 * личную работу вместе и не давит на собеседника.
 */

export type ReferralStatus =
  | 'selected'
  | 'pitch_ready'
  | 'request_sent'
  | 'replied_positive'
  | 'replied_declined'
  | 'no_reply';

export interface ReferralTrack {
  readonly contactId: string;
  readonly status: ReferralStatus;
  readonly pitch: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sentByCandidateAt: string | null;
}

export type ReferralEvent =
  | { readonly type: 'draft_pitch'; readonly pitch: string }
  | { readonly type: 'candidate_sent_request' }
  | { readonly type: 'record_reply'; readonly outcome: 'positive' | 'declined' }
  | { readonly type: 'mark_no_reply' };

export type PitchViolation = 'false_acquaintance' | 'pressure';

const VIOLATION_PATTERNS: ReadonlyArray<readonly [PitchViolation, RegExp]> = [
  [
    'false_acquaintance',
    /лично\s+(?:работал|знаком|знаю)|работали\s+вместе|мы\s+давно\s+знакомы/iu,
  ],
  [
    'pressure',
    /срочно|последн(?:яя|ий)\s+(?:надежда|шанс)|обязан|только\s+вы\s+можете|иначе\s+я/iu,
  ],
];

export function pitchViolations(text: string): readonly PitchViolation[] {
  return VIOLATION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

export function newReferralTrack(contactId: string, now: string): ReferralTrack {
  return {
    contactId,
    status: 'selected',
    pitch: null,
    createdAt: now,
    updatedAt: now,
    sentByCandidateAt: null,
  };
}

export function advanceReferral(
  track: ReferralTrack,
  event: ReferralEvent,
  now: string,
): ReferralTrack {
  const base = { ...track, updatedAt: now };
  switch (event.type) {
    case 'draft_pitch': {
      if (track.status !== 'selected' && track.status !== 'pitch_ready') {
        throw new Error('Питч можно менять только до отправки запроса');
      }
      if (!event.pitch.trim()) throw new Error('Питч не может быть пустым');
      if (pitchViolations(event.pitch).length > 0) {
        throw new Error('Питч содержит давление или выдаёт знакомство за личную работу вместе');
      }
      return { ...base, status: 'pitch_ready', pitch: event.pitch };
    }
    case 'candidate_sent_request': {
      if (track.status !== 'pitch_ready') throw new Error('Сначала подготовьте питч');
      return { ...base, status: 'request_sent', sentByCandidateAt: now };
    }
    case 'record_reply': {
      if (track.status !== 'request_sent')
        throw new Error('Ответ можно записать после отправки запроса');
      return {
        ...base,
        status: event.outcome === 'positive' ? 'replied_positive' : 'replied_declined',
      };
    }
    case 'mark_no_reply': {
      if (track.status !== 'request_sent')
        throw new Error('Отсутствие ответа фиксируется после отправки запроса');
      return { ...base, status: 'no_reply' };
    }
  }
}

export type ReferralBasis =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'shared_community' | 'shared_employer' | 'shared_event';
      readonly detail: string;
    };

export interface ReferralPitchInput {
  readonly candidateName: string;
  readonly targetRole: string;
  readonly company: string;
  readonly contactName: string;
  readonly basis: ReferralBasis;
  /** Только подтверждённые факты кандидата. */
  readonly facts: readonly string[];
}

const BASIS_LINE: Record<'shared_community' | 'shared_employer' | 'shared_event', string> = {
  shared_community: 'Нас объединяет',
  shared_employer: 'Мы оба связаны с компанией',
  shared_event: 'Мы пересекались на мероприятии',
};

export function buildReferralPitch(input: ReferralPitchInput): string {
  const { contactName, candidateName, company, targetRole, basis, facts } = input;
  const opening =
    basis.kind === 'none'
      ? `Здравствуйте, ${contactName}! Мы не знакомы, пишу вам, потому что вы работаете в ${company}.`
      : `Здравствуйте, ${contactName}! ${BASIS_LINE[basis.kind]}: ${basis.detail}.`;
  const about = facts.length > 0 ? ` Коротко о себе: ${facts.slice(0, 2).join('; ')}.` : '';
  return [
    opening,
    `Меня зовут ${candidateName}, я рассматриваю позицию «${targetRole}» в ${company}.${about}`,
    'Если сочтёте уместным, подскажите, как лучше передать моё резюме в команду, или порекомендуйте меня, когда познакомитесь с моими материалами ближе.',
    'Если вам это неудобно, ничего страшного: спасибо, что прочитали.',
  ].join('\n\n');
}
