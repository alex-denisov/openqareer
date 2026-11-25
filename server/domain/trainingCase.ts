/**
 * B635: вид задачи тренировки по роли отклика. Руководителю — управленческий кейс, инженеру
 * ПО — System Design, остальным — рабочая задача роли. «Инженер» и «менеджер» сами по себе
 * о программах не говорят: решает название целиком, затем текст вакансии.
 */
export type TrainingCase = 'system' | 'leadership' | 'work';

const word = (body: string) => new RegExp(`(?<![\\p{L}\\d])(?:${body})(?![\\p{L}\\d])`, 'iu');

/** Ведёт команду руками или строит системы — не управленческий кейс. */
const HANDS_ON = word(
  'тимлид\\p{L}*|team ?lead|tech(?:nical)? lead|техлид\\p{L}*|архитектор\\p{L}*|architect',
);
const LEADER = word(
  'cto|cio|coo|ceo|cpo|cdo|ciso|chief|vp|svp|evp|vice president|вице-президент\\p{L}*|head|director|директор\\p{L}*|руководител\\p{L}*|начальник\\p{L}*|управляющ\\p{L}*|заведующ\\p{L}*|engineering manager',
);
const SOFTWARE_TITLE = word(
  'software|backend|back-end|бэкенд\\p{L}*|бекенд\\p{L}*|front\\p{L}*|фронт\\p{L}*|full-?stack|developer|dev|разработчик\\p{L}*|программист\\p{L}*|devops|sre|site reliability|platform|платформ\\p{L}*|kubernetes|cloud|облачн\\p{L}*|react|vue|angular|ios|android|mobile|мобильн\\p{L}*|flutter|golang|java|python|php|node\\.js|\\.net|ml|ai|genai|gen ai|llm|nlp|mlops|machine learning|data scien\\p{L}*|data engineer|dwh|etl|big data|машинн\\p{L}* обучени\\p{L}*|нейросет\\p{L}*|computer vision|инженер\\p{L}* данных',
);
const SOFTWARE_TEXT =
  /software|микросервис|microservice|backend|бэкенд|фронтенд|kubernetes|kafka|postgres|elasticsearch|redis|clickhouse|(?<!\p{L})(?:ci\/cd|devops|golang|typescript|python|node\.js)(?!\p{L})|разработк\p{L}* (?:по|программ|приложени|сервис)/iu;

export function trainingCase(input: {
  readonly vacancyTitle: string;
  readonly description?: string;
}): TrainingCase {
  const { vacancyTitle: title, description = '' } = input;
  if (HANDS_ON.test(title)) return 'system';
  if (LEADER.test(title)) return 'leadership';
  return SOFTWARE_TITLE.test(title) || SOFTWARE_TEXT.test(description) ? 'system' : 'work';
}

export const TRAINING_CASE_LABEL: Readonly<Record<TrainingCase, string>> = {
  system: 'System Design',
  leadership: 'Управленческий кейс',
  work: 'Рабочая задача',
};
