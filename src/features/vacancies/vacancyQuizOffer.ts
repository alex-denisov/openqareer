import { useEffect, useState } from 'react';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import type {
  RequirementImportance,
  RequirementKind,
} from '../../../server/domain/vacancyRequirements';

/** The consultant names at most two skills in one quiz offer (4-vakansii.html). */
const OFFER_SKILL_LIMIT = 2;
const DISMISSED_KEY = 'openqareer.vacancy-quiz-offer-dismissed';
const EVENT = 'openqareer:vacancy-quiz-offer';
const IMPORTANCE_ORDER: Record<RequirementImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
/** A quiz checks skills; languages, diplomas and work conditions are not quiz material. */
const NON_SKILL_KINDS = new Set<RequirementKind>([
  'language',
  'education',
  'license',
  'workFormat',
  'workAuthorization',
]);

/** Every unconfirmed skill requirement of the vacancy, most important first. */
export function unconfirmedSkills(view: VacancyFitView | undefined): string[] {
  if (!view?.result) return [];
  const matched = new Set(
    view.result.assessments
      .filter((item) => item.status === 'matched')
      .map((item) => item.requirementId),
  );
  const seen = new Set<string>();
  return [...view.requirements]
    .filter((item) => !matched.has(item.id) && !NON_SKILL_KINDS.has(item.kind))
    .sort((left, right) => IMPORTANCE_ORDER[left.importance] - IMPORTANCE_ORDER[right.importance])
    .map((item) => item.text.trim())
    .filter((text) => {
      const key = text.toLocaleLowerCase('ru');
      if (!text || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function quizOfferSkills(view: VacancyFitView | undefined): string[] {
  return unconfirmedSkills(view).slice(0, OFFER_SKILL_LIMIT);
}

export function quizOfferTitle(skills: readonly string[]): string {
  return `Пройти квиз по ${skills.join(' и ')}`;
}

function readDismissed(): Record<string, readonly string[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

const skillKey = (skill: string) => skill.toLocaleLowerCase('ru');

/** «Не сейчас» remembers the unconfirmed skills it was shown for, per vacancy. */
export function dismissQuizOffer(vacancyId: string, skills: readonly string[]): void {
  try {
    const next = { ...readDismissed(), [vacancyId]: skills.map(skillKey) };
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Storage can be blocked; the card then hides only until the next mount.
  }
}

/** Hidden until an unconfirmed skill appears that the candidate has not declined. */
export function isQuizOfferDismissed(vacancyId: string, skills: readonly string[]): boolean {
  const declined = readDismissed()[vacancyId];
  if (!Array.isArray(declined)) return false;
  return skills.every((skill) => declined.includes(skillKey(skill)));
}

/** The expanded vacancy the consultant panel may offer a quiz for. */
export interface VacancyQuizOffer {
  readonly vacancyId: string;
  readonly roleTitle: string;
  /** All unconfirmed skills, most important first; the offer names the first two. */
  readonly skills: readonly string[];
}

let current: VacancyQuizOffer | null = null;

export function publishVacancyQuizOffer(offer: VacancyQuizOffer | null): void {
  current = offer;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT));
}

export function useVacancyQuizOffer(): VacancyQuizOffer | null {
  const [offer, setOffer] = useState(current);
  useEffect(() => {
    const update = () => setOffer(current);
    update();
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return offer;
}
