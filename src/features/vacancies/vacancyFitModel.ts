import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  FIT_KEY_GATES,
  vacancyFitCeiling,
  vacancyFitPercent,
  vacancyFitStage,
  vacancyFitTier,
  type VacancyFitTier,
} from '../../../shared/vacancyFitPercent';
import { fitRequirementChips } from './vacancyRequirementChips';
import { quizOfferSkills, quizOfferTitle } from './vacancyQuizOffer';

/** The row cell, the 390 row and the expanded block read this one model (28.10 mockup). */
export type VacancyFitMark =
  | {
      readonly kind: 'number';
      readonly percent: number;
      readonly tier: VacancyFitTier;
      readonly caption: string;
      readonly ariaLabel: string;
    }
  | { readonly kind: 'pending'; readonly ariaLabel: string }
  | { readonly kind: 'none'; readonly caption: string; readonly ariaLabel: string };

function noneCaption(view: VacancyFitView | undefined): string {
  if (view?.state === 'no_description') return 'нет описания';
  if (view?.state === 'no_requirements') return 'мало требований';
  if (view?.state === 'failed') return 'не посчитан';
  switch (view?.result?.reason) {
    case 'no_eligible_facts':
      return 'нет профиля';
    case 'blocked_gate':
      return 'условие не совпадает';
    case 'unknown_gate':
      return 'условия не подтверждены';
    case 'assessment_unavailable':
      return 'не посчитан';
    default:
      return 'мало требований';
  }
}

export function vacancyFitMark(view: VacancyFitView | undefined): VacancyFitMark {
  const percent = vacancyFitPercent(view);
  if (percent !== null) {
    const total = view!.result!.coverage.total;
    return {
      kind: 'number',
      percent,
      tier: vacancyFitTier(percent),
      caption: `по ${total} треб.`,
      ariaLabel: `Совпадение ${percent} %, по ${total} требованиям`,
    };
  }
  if (vacancyFitStage(view) === 'counting')
    return { kind: 'pending', ariaLabel: 'Совпадение считается' };
  const caption = noneCaption(view);
  return { kind: 'none', caption, ariaLabel: `Процента нет: ${caption}` };
}

const NAMES_SHOWN = 3;
const GATE_WORDS: Record<(typeof FIT_KEY_GATES)[number], string> = {
  role: 'роль',
  region: 'регион',
  workAuthorization: 'право на работу',
};

function listRu(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

function namedMissing(names: readonly string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const rest = names.length - NAMES_SHOWN;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/**
 * «X из N требований вакансии есть в профиле. Не нашли в профиле: A, B — они не засчитаны.»
 * The server counts a requirement fully when a profile fact proves it and not at all otherwise;
 * an unconfirmed role, region or work permit caps the percent 10 points each.
 */
export function vacancyFitSentence(view: VacancyFitView | undefined): string | null {
  if (vacancyFitPercent(view) === null) return null;
  const result = view!.result!;
  const { matched, total } = result.coverage;
  const parts = [`${matched} из ${total} требований вакансии есть в профиле.`];
  const missing = fitRequirementChips(view)?.unconfirmed ?? [];
  if (matched < total && missing.length > 0)
    parts.push(`Не нашли в профиле: ${namedMissing(missing)} — они не засчитаны.`);
  const gates = FIT_KEY_GATES.filter((name) => result.gates?.[name]?.status !== 'matched');
  if (gates.length > 0) {
    const verb = gates.length === 1 ? 'Не подтверждено' : 'Не подтверждены';
    const words = listRu(gates.map((name) => GATE_WORDS[name]));
    parts.push(`${verb} ${words}: процент не выше ${vacancyFitCeiling(result)} %.`);
  }
  return parts.join(' ');
}

export interface VacancyFitBoost {
  readonly label: string;
  readonly skills: readonly string[];
}

/** «Поднять до N %: квиз по A и B» — only when the skill check can start and would raise it. */
export function vacancyFitBoost(
  view: VacancyFitView | undefined,
  checkStartable: boolean,
): VacancyFitBoost | null {
  const percent = vacancyFitPercent(view);
  if (!checkStartable || percent === null) return null;
  const skills = quizOfferSkills(view);
  if (skills.length === 0) return null;
  const { matched, total } = view!.result!.coverage;
  const target = Math.min(
    vacancyFitCeiling(view!.result!),
    Math.round(((matched + skills.length) / total) * 100),
  );
  if (target <= percent) return null;
  const quiz = quizOfferTitle(skills).replace(/^Пройти к/u, 'к');
  return { label: `Поднять до ${target} %: ${quiz}`, skills };
}
