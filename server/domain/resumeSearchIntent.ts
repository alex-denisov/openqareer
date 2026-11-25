import type { ResumeAssertion, ResumeExperience } from './resumeStudioTypes';

/** Строка о поиске работы, а не о сделанном: в резюме под вакансию её нет (B785). */
const INTENT: readonly RegExp[] = [
  /^(?:currently |now |temporarily )?(?:pausing|paused|stepping (?:back|away)|winding down)\b.{0,120}\bto (?:pursue|seek|look for|search for|find|focus on finding|explore)\b.{0,80}\b(?:roles?|positions?|opportunit(?:y|ies)|jobs?)\b/iu,
  /^(?:i am |i'm |currently |now |actively |available and )*(?:open to|seeking|looking for|searching for|pursuing)\b.{0,80}\b(?:roles?|positions?|opportunit(?:y|ies)|jobs?|employment)\b/iu,
  /^(?:сейчас |активно |временно |я )*(?:ищу|в поиске|нахожусь в поиске|открыт[а]? (?:к|для)|рассматриваю)(?!\p{L}).{0,80}(?:работ|рол[ьи]|позици|должност|предложени|ваканси)/iu,
  /^(?:сейчас |временно |я )*(?:приостан\p{L}+|ставлю на паузу|сворачиваю)(?!\p{L}).{0,120}(?:чтобы|ради).{0,80}(?:рол[ьи]|позици|должност|ваканси|работу)/iu,
];

export const isSearchIntent = (text: string): boolean =>
  INTENT.some((pattern) => pattern.test(text.trim().replace(/^[-•–—*]\s+/u, '')));

/** Описание места без строк о поиске работы; не осталось ничего — `null`. */
export function withoutIntentLines(
  description: ResumeAssertion | null | undefined,
): ResumeAssertion | null | undefined {
  if (!description) return description;
  const lines = description.value.split('\n');
  const kept = lines.filter((line) => !isSearchIntent(line));
  if (kept.length === lines.length) return description;
  const value = kept.join('\n').trim();
  return value ? { ...description, value } : null;
}

export function withoutSearchIntent(role: ResumeExperience): ResumeExperience {
  const description = withoutIntentLines(role.description);
  const bullets = role.bullets.filter((bullet) => !isSearchIntent(bullet.value));
  return description === role.description && bullets.length === role.bullets.length
    ? role
    : { ...role, ...(description === undefined ? {} : { description }), bullets };
}
