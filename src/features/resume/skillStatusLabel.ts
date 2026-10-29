import type { SkillConfirmation } from '../skills/skillConfirmationApi';
import type { ResumeSkillInput } from './resumeTypes';

export type SkillStatusLabel =
  'Подтверждено' | 'Разобрано в беседе' | 'Квиз не пройден' | 'Без квиза';

/**
 * Mockup 2 wording. «Квиз не пройден» only when an attempt exists and failed (B3);
 * a skill nobody checked reads «Без квиза».
 */
export function skillStatusLabel(
  skill: ResumeSkillInput,
  confirmation?: SkillConfirmation,
): SkillStatusLabel {
  if (skill.status === 'подтверждён') return 'Подтверждено';
  if (confirmation?.conversation.state === 'discussed') return 'Разобрано в беседе';
  // «не подтверждён» is written only by a failed quiz, so it reads like a failed attempt.
  if (skill.status === 'не подтверждён') return 'Квиз не пройден';
  if (confirmation?.lastAttempt && !confirmation.lastAttempt.passed) return 'Квиз не пройден';
  return 'Без квиза';
}
