import type { VacancyBrief } from '../../../../../shared/vacancyBrief';
import type { VacancyFitView } from '../../../../../shared/vacancyFit';
import { vacancyFitPercent } from '../../../../../shared/vacancyFitPercent';
import {
  countedSkillRequirements,
  requirementVerdict,
  wishRequirements,
} from '../../../vacancies/vacancyRequirementChips';

export type RequirementMark = 'частично' | 'нет в профиле' | 'желательно';

export interface RequirementLine {
  readonly text: string;
  readonly mark?: RequirementMark;
}

export interface VacancySections {
  readonly duties: readonly string[];
  readonly requirements: readonly RequirementLine[];
  readonly conditions: readonly string[];
}

/** Короче — совпадение цитаты со строкой случайно («Go» внутри «Google»). */
const MIN_QUOTE_IN_LINE = 2;

const words = (text: string): string =>
  ` ${text
    .toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()} `;

type Counted = ReturnType<typeof countedSkillRequirements>[number];

function belongsTo(line: string, requirement: Counted): boolean {
  const [own, quote] = [words(line), words(requirement.sourceQuote || requirement.text)];
  if (quote.trim().length < MIN_QUOTE_IN_LINE || own.trim().length < MIN_QUOTE_IN_LINE)
    return false;
  return own.includes(quote) || quote.includes(own);
}

/** «нет в профиле» — только когда нет ни одного требования строки; иначе о строке «частично». */
function markOf(
  view: VacancyFitView,
  requirements: readonly Counted[],
): RequirementMark | undefined {
  const statuses = requirements.map(({ id }) => requirementVerdict(view, id).status);
  if (statuses.length === 0) return undefined;
  if (statuses.every((status) => status === 'unmatched')) return 'нет в профиле';
  return statuses.some((status) => status === 'partial' || status === 'unmatched')
    ? 'частично'
    : undefined;
}

/** Строка из одних пожеланий вне счёта — с той же пометкой, что в «Почему N %». */
function wishMarkOf(
  view: VacancyFitView,
  wishes: readonly Counted[],
): RequirementMark | undefined {
  if (wishes.length === 0) return undefined;
  const partial = wishes.every(({ id }) => requirementVerdict(view, id).status === 'partial');
  return partial ? 'частично' : 'желательно';
}

function unique(lines: readonly string[]): readonly string[] {
  const keys = lines.map(words);
  return lines.filter((_, index) => keys.indexOf(keys[index]!) === index);
}

function requirementLines(
  brief: VacancyBrief,
  fit: VacancyFitView | undefined,
): readonly RequirementLine[] {
  const ready = fit && vacancyFitPercent(fit) !== null ? fit : undefined;
  const counted = ready
    ? countedSkillRequirements(ready).filter(({ origin }) => origin !== 'inferred')
    : [];
  const wishes = wishRequirements(ready);
  const line = (
    text: string,
    own: readonly Counted[],
    ownWishes: readonly Counted[],
  ): RequirementLine => {
    const mark = ready
      ? own.length > 0
        ? markOf(ready, own)
        : wishMarkOf(ready, ownWishes)
      : undefined;
    return mark ? { text, mark } : { text };
  };
  if (brief.requirements.length > 0) {
    return unique(brief.requirements).map((text) =>
      line(
        text,
        counted.filter((requirement) => belongsTo(text, requirement)),
        wishes.filter((requirement) => belongsTo(text, requirement)),
      ),
    );
  }
  return [
    ...counted.map((requirement) => line(requirement.text.trim(), [requirement], [])),
    ...wishes.map((requirement) => line(requirement.text.trim(), [], [requirement])),
  ];
}

/** Разделы карточки (B800); `null` — в тексте их нет, показываются абзацы. */
export function vacancySections(
  brief: VacancyBrief,
  fit: VacancyFitView | undefined,
): VacancySections | null {
  if (brief.duties.length === 0 && brief.requirements.length === 0) return null;
  return {
    duties: unique(brief.duties),
    requirements: requirementLines(brief, fit),
    conditions: unique(brief.conditions ?? []),
  };
}
