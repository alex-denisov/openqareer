import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  vacancyFitPercent,
  vacancyFitStage,
  vacancyFitTier,
  type VacancyFitTier,
} from '../../../shared/vacancyFitPercent';
import { fitRequirementChips } from './vacancyRequirementChips';
import { quizOfferSkills } from './vacancyQuizOffer';

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

/** Owner 29.10: a row without a percent says only «мало требований» or «нет профиля». */
function noneCaption(view: VacancyFitView | undefined): 'нет профиля' | 'мало требований' {
  return view?.result?.reason === 'no_eligible_facts' ? 'нет профиля' : 'мало требований';
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

/**
 * «X из Y требований вакансии есть в профиле. Не проверены квизом: A, B.» Since 01.11 a stated
 * requirement counts in full; the check is a label, not a multiplier.
 */
export function vacancyFitSentence(view: VacancyFitView | undefined): string | null {
  if (vacancyFitPercent(view) === null) return null;
  const { total, matched, partial = 0 } = view!.result!.coverage;
  const stated = fitRequirementChips(view)?.stated ?? [];
  const parts = [`${matched} из ${total} требований вакансии есть в профиле.`];
  if (partial > 0) parts.push(`Ещё ${partial} — частично, они считаются наполовину.`);
  if (stated.length > 0) parts.push(`Не проверены квизом: ${stated.join(', ')}.`);
  return parts.join(' ');
}

export interface VacancyFitBoost {
  readonly label: string;
  readonly skills: readonly string[];
}

/** «Подтвердить квизом: A и B» whenever requirements stated in the profile are unchecked (01.11: the percent stays). */
export function vacancyFitBoost(view: VacancyFitView | undefined): VacancyFitBoost | null {
  const percent = vacancyFitPercent(view);
  const stated = fitRequirementChips(view)?.stated ?? [];
  if (percent === null || stated.length === 0) return null;
  // The quiz names the stated skills; experience the quiz does not pick still gets the button.
  const quizzable = quizOfferSkills(view).filter((skill) => stated.includes(skill));
  const skills = quizzable.length > 0 ? quizzable : stated.slice(0, 2);
  return { label: `Проверить навыки: ${skills.join(', ')}`, skills };
}

/** Below this many counted skill requirements a percent rests on too little text (02.11). */
export const FIT_CONFIDENT_REQUIREMENTS = 6;

/** A visible hint, not a formula change: 4 of 4 reads as 100 % but says little. */
export function vacancyFitConfidenceHint(view: VacancyFitView | undefined): string | null {
  if (vacancyFitPercent(view) === null) return null;
  const { total } = view!.result!.coverage;
  if (total >= FIT_CONFIDENT_REQUIREMENTS) return null;
  return `Посчитано всего по ${total} требованиям из текста вакансии — процент приблизительный.`;
}

export interface VacancyFitConditionFlag {
  readonly short: string;
  readonly text: string;
}

/** 02.11: a condition a profile fact contradicts; the percent stays a skill-coverage number. */
export function vacancyFitConditionBlock(
  view: VacancyFitView | undefined,
): VacancyFitConditionFlag | null {
  const blocks = view?.result?.conditionBlocks ?? [];
  if (blocks.length === 0) return null;
  const short = 'Не подходит по условиям';
  const conditions = blocks.map((block) => block.text).join('; ');
  const quotes = blocks.map((block) => `«${block.quote}»`).join(', ');
  return { short, text: `${short}: ${conditions}. В профиле: ${quotes}.` };
}
