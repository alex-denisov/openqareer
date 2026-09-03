import { z } from 'zod';
import type { RoleNameLanguage } from './roleNameLanguage';

/**
 * Модель называет роли по резюме (B180, срез 1в).
 *
 * Рынок назвать роль не может: замер на проде дал 514 групп на 529 вакансий и
 * ни одной группы с восемью наблюдениями. Владелец назвал причину прямо —
 * чтобы рынок называл роль сам, нужны десятки тысяч вакансий в сегменте.
 * Поэтому имя приходит от модели, а пул остаётся доказательством.
 *
 * Инструкция запрещает модели ровно две вещи, которые она сделала бы охотно:
 * называть числа и упорядочивать роли по «востребованности». И то и другое
 * считает код по пулу — иначе на экране появилось бы число без знаменателя,
 * против которого и заведён `PRB-016`.
 */
/**
 * Язык названия выбирает код, а не модель (`roleNameLanguage.ts`).
 *
 * До этого язык был побочным эффектом выбора провайдера: смена головы очереди
 * переписала кандидату его же роли с английских на русские. Инструкция теперь
 * называет язык прямо — и отдельно запрещает единственное, что модель сделала
 * бы охотно и что было бы враньём: перевести название, которого на этом рынке
 * не существует (решение владельца 2026-09-03; «Инженер доступности» — это
 * другая роль, а не перевод DevOps Engineer).
 */
export function roleNamingInstructions(language: RoleNameLanguage): string {
  return [
    'Ты читаешь факты о кандидате и называешь роли, которые он может искать.',
    'Отвечай только JSON по схеме, без пояснений вокруг.',
    'Назови от трёх до пяти ролей — так, как они называются в вакансиях,',
    'а не описанием обязанностей и не фразой из резюме.',
    ...(language === 'ru'
      ? [
          'Названия ролей давай по-русски — так, как их пишут в русских вакансиях.',
          'Если устоявшегося русского названия у роли нет, не переводи его:',
          'оставь английское, как его пишет рынок (DevOps Engineer, SRE, QA).',
        ]
      : [
          'Названия ролей давай по-английски — так, как их пишут в вакансиях.',
        ]),
    'Каждая роль — короткое название должности (до 60 символов).',
    'Для каждой роли объясни в одном предложении, что именно в фактах кандидата',
    'её породило, и перечисли ссылки на эти факты из поля ref.',
    'Запрещено: любые числа, проценты, оценки востребованности, зарплаты,',
    'слова «подходит», «не подходит», «уровень», «балл».',
    'Порядок ролей не важен: его определяет не ты.',
    'Формат ответа — ровно такой:',
    '{"roles":[{"title":"Product Manager","reason":"девять лет вёл внутренние продукты",',
    '"evidenceRefs":["memory:1"]}]}',
    'Имена полей именно эти: title, reason, evidenceRefs.',
  ].join(' ');
}

/**
 * Бесплатная модель не держит имена полей: живой ответ
 * `nemotron-3-ultra:free` с прода 2026-09-03 пришёл голым массивом
 * `{role, explanation, refs}`. Просить строго и читать снисходительно дешевле,
 * чем терять названную роль из-за буквы; смысл при этом не размывается — поля
 * ровно те же три, и любое лишнее отбрасывается.
 */
const namedRoleSchema = z
  .object({
    title: z.string().trim().min(2).max(60).optional(),
    role: z.string().trim().min(2).max(60).optional(),
    reason: z.string().trim().min(1).max(400).optional(),
    explanation: z.string().trim().min(1).max(400).optional(),
    evidenceRefs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    refs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .transform((value) => ({
    title: value.title ?? value.role ?? '',
    reason: value.reason ?? value.explanation ?? '',
    evidenceRefs: value.evidenceRefs ?? value.refs ?? [],
  }))
  .refine((value) => value.title.length >= 2 && value.reason.length >= 1);

export const roleNamingSchema = z
  .union([
    z.object({ roles: z.array(namedRoleSchema).max(8) }),
    z.array(namedRoleSchema).max(8),
  ])
  .transform((value) => (Array.isArray(value) ? { roles: value } : value));

export type NamedRoleAnswer = z.infer<typeof roleNamingSchema>;

export const ROLE_NAMING_JSON_SCHEMA = {
  name: 'named_roles',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['roles'],
    properties: {
      roles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'reason', 'evidenceRefs'],
          properties: {
            title: { type: 'string' },
            reason: { type: 'string' },
            evidenceRefs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
