import { pluralWordRu } from '../../../shared/pluralRu';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  STATED_REQUIREMENT_CREDIT,
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
 * «X из Y требований вакансии есть в профиле и подтверждены. Ещё Z указаны, но не проверены:
 * A, B — они считаются наполовину.» (mockup 4-vakansii-procent-sort, owner 29.10)
 */
export function vacancyFitSentence(view: VacancyFitView | undefined): string | null {
  if (vacancyFitPercent(view) === null) return null;
  const { total } = view!.result!.coverage;
  const chips = fitRequirementChips(view);
  const checked = view!.result!.coverage.checked ?? chips?.confirmed.length ?? 0;
  const stated = chips?.stated ?? [];
  const first = `${checked} из ${total} требований вакансии есть в профиле и подтверждены.`;
  if (stated.length === 0) return first;
  const tail =
    pluralWordRu(stated.length, ['one', 'many', 'many']) === 'one'
      ? 'указан, но не проверен: NAMES — он считается наполовину.'
      : 'указаны, но не проверены: NAMES — они считаются наполовину.';
  return `${first} Ещё ${stated.length} ${tail.replace('NAMES', stated.join(', '))}`;
}

export interface VacancyFitBoost {
  readonly label: string;
  readonly skills: readonly string[];
}

/** «Поднять до N %: квиз по A и B» whenever requirements stated in the profile are unchecked. */
export function vacancyFitBoost(view: VacancyFitView | undefined): VacancyFitBoost | null {
  const percent = vacancyFitPercent(view);
  const stated = fitRequirementChips(view)?.stated ?? [];
  if (percent === null || stated.length === 0) return null;
  // The quiz names the stated skills; experience the quiz does not pick still gets the button.
  const quizzable = quizOfferSkills(view).filter((skill) => stated.includes(skill));
  const skills = quizzable.length > 0 ? quizzable : stated.slice(0, 2);
  const { matched, total } = view!.result!.coverage;
  const checked = view!.result!.coverage.checked ?? 0;
  const halves = matched - checked - skills.length;
  const target = Math.round(
    ((checked + skills.length + halves * STATED_REQUIREMENT_CREDIT) / total) * 100,
  );
  if (target <= percent) return null;
  const quiz = quizOfferTitle(skills).replace(/^Пройти к/u, 'к');
  return { label: `Поднять до ${target} %: ${quiz}`, skills };
}
