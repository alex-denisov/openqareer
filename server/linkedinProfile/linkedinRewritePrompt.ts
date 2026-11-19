import type { LinkedinRewriteRequest } from './linkedinRewrite';

/** B645 (a03): промпт переписывания «О себе» и «Опыта» для LinkedIn. Редакция — в `LINKEDIN_REWRITE_PROMPT_REVISION`. */
export const LINKEDIN_REWRITE_INSTRUCTIONS = `Ты карьерный консультант. Напиши для профиля LinkedIn кандидата два раздела: «О себе» и короткое описание каждого места работы. Ниже его целевая роль и подтверждённые факты; у каждого факта есть id.

Правила:
- Пиши заново, своими словами. Не переписывай факт целиком и не склеивай факты подряд: это пересказ для читателя-рекрутера, а не выписка.
- Только то, что есть в фактах. Не добавляй навыков, должностей, компаний, сроков и результатов, которых там нет.
- Числа — только те, что стоят в фактах, которые ты указал в factIds этого текста.
- Язык всех текстов — language из входа ("ru" — русский, "en" — английский).
- «О себе»: от первого лица, 3–5 предложений, до 1200 знаков. Кто кандидат и куда идёт (целевая роль), в чём сильнее всего, чем это подтверждено. Без списка должностей и дат.
- Место работы: 2–3 предложения, до 400 знаков, без «я» и «мы», начинай с действия или результата. Название компании и должность не повторяй — они уже стоят над текстом.
- В factIds — id фактов, на которых стоит текст. Только из своего раздела: для места — только факты этого места.
- Если для «О себе» фактов мало, верни about с пустым text и пустым factIds. Место без пригодных фактов не включай.

Ответ — JSON по схеме.`;

const ANSWER = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'factIds'],
  properties: { text: { type: 'string' }, factIds: { type: 'array', items: { type: 'string' } } },
} as const;

export const LINKEDIN_REWRITE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['about', 'places'],
  properties: {
    about: ANSWER,
    places: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'factIds'],
        properties: { id: { type: 'string' }, ...ANSWER.properties },
      },
    },
  },
} as const;

export function linkedinRewriteUserMessage(request: LinkedinRewriteRequest): string {
  return `<profile>\n${JSON.stringify(request, null, 1)}\n</profile>`;
}
