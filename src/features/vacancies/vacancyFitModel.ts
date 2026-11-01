import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
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
  const quiz = quizOfferTitle(skills).replace(/^Пройти к/u, 'к');
  return { label: `Подтвердить навыки: ${quiz}`, skills };
}
