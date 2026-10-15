import type { CoachTurnStage } from '../coach/coachApi';

export const STARTER_PROMPTS_BY_STAGE: Readonly<Record<CoachTurnStage, readonly string[]>> = {
  today: ['С чего начать сегодня?', 'Как оценить этот шаг?', 'Что проверить перед решением?'],
  profile: [
    'Что проверить в моём профиле?',
    'Как точнее описать мой опыт?',
    'Какие факты уточнить в резюме?',
  ],
  career: [
    'Какие роли мне подходят?',
    'Как сравнить два направления?',
    'Что проверить перед сменой роли?',
  ],
  vacancies: [
    'Что уточнить в этой вакансии?',
    'С чем сравнить мой опыт?',
    'Какие требования мне проверить?',
  ],
  responses: [
    'Когда напомнить о моём отклике?',
    'Как написать рекрутеру?',
    'Что обсудить после отклика?',
  ],
  interviews: [
    'Как подготовиться к вопросам?',
    'О чём спросить команду?',
    'Как разобрать мой ответ?',
  ],
};

export function starterPromptsForStage(stage: CoachTurnStage): readonly string[] {
  return STARTER_PROMPTS_BY_STAGE[stage];
}
