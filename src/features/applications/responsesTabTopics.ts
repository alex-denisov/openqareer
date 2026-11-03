import type { ConsultantScreenTopic } from '../journey/consultantScreenTopic';
import type { ResponsesWorkspaceSection } from './ResponsesWorkspaceControls';

/**
 * Вступление и вопросы консультанта на каждой вкладке «Отклики» (B511 G3b п. 3).
 * «Воронка» остаётся на общей теме этапа `responses` (`STAGE_INITIAL_REPLICA`,
 * `STARTER_PROMPTS_BY_STAGE`), остальные вкладки говорят о своём.
 */
export const RESPONSES_TAB_TOPICS: Readonly<
  Record<ResponsesWorkspaceSection, ConsultantScreenTopic | null>
> = {
  funnel: null,
  'company-wants': {
    id: 'responses-company-wants',
    stages: ['responses'],
    intro: 'Помогу выбрать компании и найти путь в каждую: вакансию, знакомого или рекрутера.',
    prompts: [
      'Как найти путь в компанию?',
      'Кому написать в компании?',
      'Какие компании добавить?',
    ],
  },
  preparation: {
    id: 'responses-preparation',
    stages: ['responses'],
    intro: 'Соберу вопросы, которые вам вероятно зададут, и ответы из вашего опыта.',
    prompts: [
      'Как подготовиться к интервью?',
      'Какую STAR-историю рассказать?',
      'Что записать в дебриф?',
    ],
  },
  offers: {
    id: 'responses-offers',
    stages: ['responses'],
    intro: 'Сравню офферы по деньгам и условиям и подскажу, что уточнить перед ответом.',
    prompts: ['Как сравнить офферы?', 'Что уточнить в оффере?', 'Как обсудить условия?'],
  },
};
