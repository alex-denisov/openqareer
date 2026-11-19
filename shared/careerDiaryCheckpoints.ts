/**
 * B687: проверка на 30-й день (d01e) и итоги 90 дней (d04). Всё считается из целей,
 * замеров, задач плана и карты людей; тексты для резюме и разговора не несут
 * внутренних показателей работодателя.
 */
export type CareerDiaryDay30Area = 'team' | 'result' | 'plan';

export interface CareerDiaryDay30Fact {
  readonly area: CareerDiaryDay30Area;
  readonly label: string;
  readonly value: string;
}

export interface CareerDiaryDay30Check {
  readonly workplaceId: string;
  /** 30-й день на новом месте. */
  readonly dueOn: string;
  readonly facts: readonly CareerDiaryDay30Fact[];
  /** Один сигнал: самое слабое место первого месяца; `null` — всё по плану. */
  readonly signal: { readonly area: CareerDiaryDay30Area; readonly text: string } | null;
  /** Черновик письма руководителю с просьбой о встрече. */
  readonly letter: string;
  /** Когда кандидат отметил, что письмо отправлено. */
  readonly sentOn: string | null;
}

export type CareerDiaryResultStatus = 'done' | 'behind' | 'open';

export interface CareerDiaryResultItem {
  readonly goalId: string;
  readonly title: string;
  /** «с 14 до 5 дней» или «цель — 2, не достигнута». */
  readonly line: string;
  readonly status: CareerDiaryResultStatus;
}

export interface CareerDiaryResults90 {
  readonly workplaceId: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly items: readonly CareerDiaryResultItem[];
  /** «Для резюме»: достигнутое без цифр работодателя; `null` — нечего показать. */
  readonly resumeText: string | null;
  /** «Для разговора об итоговой оценке». */
  readonly talkText: string | null;
}
