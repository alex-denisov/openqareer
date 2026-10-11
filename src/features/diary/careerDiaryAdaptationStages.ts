import type { CareerDiaryAdaptationStage } from './careerDiaryPlanning';

export interface CareerDiaryAdaptationStageOption {
  readonly id: CareerDiaryAdaptationStage;
  readonly label: string;
}

export const CAREER_DIARY_ADAPTATION_STAGES: readonly CareerDiaryAdaptationStageOption[] = [
  { id: 'prep', label: 'Подготовка' },
  { id: 'days_1_30', label: 'Дни 1–30' },
  { id: 'days_31_60', label: 'Дни 31–60' },
  { id: 'days_61_90', label: 'Дни 61–90' },
];
