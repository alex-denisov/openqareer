import { useEffect, useState } from 'react';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import type { RequirementImportance } from '../../../server/domain/vacancyRequirements';
import { matchedRequirements, requirementChipLabel } from './vacancyRequirementChips';

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
type Requirement = VacancyFitView['requirements'][number];

/** A quiz checks named skills; experience, languages and work conditions are not quiz material (B510). */
function isQuizSkill(requirement: Requirement): boolean {
  return requirement.skill ?? requirement.kind === 'other';
}

/**
 * Every skill requirement a check has not confirmed: stated in the profile first (a quiz lifts
 * them from half to full credit, owner 29.10), then missing ones; most important first.
 */
export function unconfirmedSkills(view: VacancyFitView | undefined): string[] {
  if (!view?.result) return [];
  const matched = matchedRequirements(view);
  const missing = (item: Requirement) => Number(!matched.has(item.id));
  const seen = new Set<string>();
  return [...view.requirements]
    .filter((item) => matched.get(item.id) !== true && isQuizSkill(item))
    .sort(
      (left, right) =>
        missing(left) - missing(right) ||
        IMPORTANCE_ORDER[left.importance] - IMPORTANCE_ORDER[right.importance],
    )
    .map((item) => requirementChipLabel(item) ?? '')
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

/** «Пройти квиз по Kafka и Kubernetes» (mockup 4). A name of several words («Управление
 *  командой») would need declining after «по», so such skills follow «по навыкам:» (G5 W3). */
export function quizOfferTitle(skills: readonly string[]): string {
  const list = skills.join(' и ');
  if (skills.every((skill) => !/\s/u.test(skill.trim()))) return `Пройти квиз по ${list}`;
  return `Пройти квиз по ${skills.length === 1 ? 'навыку' : 'навыкам'}: ${list}`;
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

const SKILL_CHECK_EVENT = 'openqareer:vacancy-skill-check';

/** What a skill check started from a vacancy covers. */
export interface VacancySkillCheckRequest {
  readonly vacancyId: string;
  readonly roleTitle: string;
  readonly skills: readonly string[];
}

/** «Поднять до N %» in the expanded vacancy starts the same check as the consultant's «Начать». */
export function requestVacancySkillCheck(request: VacancySkillCheckRequest): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(SKILL_CHECK_EVENT, { detail: request }));
}

export function useVacancySkillCheckRequests(
  onRequest: (request: VacancySkillCheckRequest) => void,
): void {
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<VacancySkillCheckRequest>).detail;
      if (detail?.vacancyId && Array.isArray(detail.skills)) onRequest(detail);
    };
    window.addEventListener(SKILL_CHECK_EVENT, listener);
    return () => window.removeEventListener(SKILL_CHECK_EVENT, listener);
  }, [onRequest]);
}
