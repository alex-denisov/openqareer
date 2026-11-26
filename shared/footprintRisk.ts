import type { FootprintRemoval } from './footprintRemoval';
/**
 * B667: сводка цифрового следа глазами работодателя. Пять категорий макета,
 * у каждой находки — уровень словом и одно действие. Составного балла нет.
 * В ответе нет названий инструментов и способа поиска.
 */
export const FOOTPRINT_RISK_CATEGORIES = [
  'personal_data',
  'needs_check',
  'resume_mismatch',
  'stale_profile',
  'useful_evidence',
] as const;
export type FootprintRiskCategoryId = (typeof FOOTPRINT_RISK_CATEGORIES)[number];

export const FOOTPRINT_RISK_LEVELS = ['high', 'important', 'low', 'useful'] as const;
export type FootprintRiskLevel = (typeof FOOTPRINT_RISK_LEVELS)[number];

export type FootprintRiskActionKind =
  | 'close_account'
  | 'check_now'
  | 'ask_to_fix'
  | 'hide'
  | 'add_to_profile'
  /** B727: страница найдена по нику — открыть её и решить «моё / не моё». */
  | 'confirm_owner'
  /** B382: полезная страница, которую в профиль не перенести, — только «Это не моё». */
  | 'not_mine';

export interface FootprintRiskAction {
  readonly kind: FootprintRiskActionKind;
  readonly label: string;
}

/** Расхождение с резюме: что в профиле и что нашлось. */
export interface FootprintRiskMismatch {
  readonly field: string;
  readonly profileValue: string;
  readonly foundValue: string;
}

export interface FootprintRiskItem {
  readonly id: string;
  readonly category: FootprintRiskCategoryId;
  readonly level: FootprintRiskLevel;
  readonly levelLabel: string;
  /** Почему такой уровень: «номер находят по имени» (B645 f03b); нет — старый ответ. */
  readonly levelReason?: string;
  readonly title: string;
  readonly detail: string;
  readonly url: string | null;
  readonly observedAt: string | null;
  /** Кандидат уже разобрал находку: её не считаем в «стоит убрать». */
  readonly resolved: boolean;
  readonly action: FootprintRiskAction | null;
  /** Находка следа, к которой относится расхождение; `null` — страница не среди находок. */
  readonly findingId: string | null;
  readonly mismatch: FootprintRiskMismatch | null;
  /** B382: запрос на удаление и итог повторной проверки; нет — запроса не было. */
  readonly removal?: FootprintRemoval;
}

export interface FootprintRiskCategory {
  readonly id: FootprintRiskCategoryId;
  readonly title: string;
  readonly count: number;
  /** Самый высокий уровень среди находок категории; `null` — находок нет. */
  readonly level: FootprintRiskLevel | null;
  readonly levelLabel: string | null;
  /** Где найдено: названия первых находок через « · ». */
  readonly where: string;
}

export type FootprintRiskState = 'not_checked' | 'checking' | 'ready' | 'failed';

export interface FootprintRiskSummary {
  readonly state: FootprintRiskState;
  readonly checkedAt: string | null;
  readonly total: number;
  /** Сколько находок стоит убрать: рисковые и ещё не разобранные. */
  readonly toRemove: number;
  /** «6 находок, 3 стоит убрать» или «Ничего рискового»; `null`, пока проверки не было. */
  readonly headline: string | null;
  readonly categories: readonly FootprintRiskCategory[];
  /** Рисковые → нейтральные → полезные. */
  readonly items: readonly FootprintRiskItem[];
}

export const FOOTPRINT_CATEGORY_TITLES: Record<FootprintRiskCategoryId, string> = {
  personal_data: 'Личные данные открыты',
  needs_check: 'Нужно проверить сейчас',
  resume_mismatch: 'Расхождения с резюме',
  stale_profile: 'Устаревшие профили',
  useful_evidence: 'Полезные доказательства',
};

export const FOOTPRINT_LEVEL_LABELS: Record<FootprintRiskLevel, string> = {
  high: 'высокий риск',
  important: 'важно',
  low: 'низкий риск',
  useful: 'полезно',
};
