import type { CoachPhase } from '../domain/coach';

const PHASE_SIGNALS: ReadonlyArray<{
  phase: CoachPhase;
  pattern: RegExp;
}> = [
  {
    phase: 'targeting',
    pattern:
      /(?:отклик|сопроводительн|application|cover letter|личн(?:ый|ое) (?:контакт|сообщение)|outreach)/iu,
  },
  {
    phase: 'resume',
    pattern: /(?:резюме|\bcv\b|resume)/iu,
  },
  {
    phase: 'market',
    pattern:
      /(?:рынок|ваканси|работодател|компани|зарплат|market|vacanc|salary)/iu,
  },
  {
    phase: 'role',
    pattern:
      /(?:карьерн(?:ый|ого) трек|направлени|роль|позиционирован|career track|career path|target role)/iu,
  },
  {
    phase: 'evidence',
    pattern:
      /(?:доказательств|результат работы|достижени|метрик|evidence|achievement)/iu,
  },
];

export function selectCoachPhase(input: {
  content: string;
  previousPhase: CoachPhase | null;
}): CoachPhase {
  return (
    PHASE_SIGNALS.find(({ pattern }) => pattern.test(input.content))?.phase ??
    input.previousPhase ??
    'discovery'
  );
}
