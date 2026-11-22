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
/**
 * Версия инструкции: входит в ключ кэша названных ролей, иначе новая
 * инструкция неделю не доходила бы до кандидатов с прежними фактами (27.10).
 */
export const ROLE_NAMING_PROMPT_VERSION = 5;

export function roleNamingInstructions(language: RoleNameLanguage): string {
  return [
    'Ты читаешь факты о кандидате и называешь роли, которые он может искать.',
    'Отвечай только JSON по схеме, без пояснений вокруг.',
    'Назови все роли, которые подтверждает опыт кандидата: на каждое направление',
    'его опыта (например, руководство разработкой, поддержка клиентов, AI,',
    'операции) — свою роль, не больше двенадцати. Уровень роли — по самому',
    'высокому уровню, на котором кандидат работал: руководителю не называй роли',
    'специалиста. Если кандидат руководил, а в смежном направлении вёл проекты,',
    'назови руководящую роль и этого направления (например, Head of AI,',
    'Customer Support Director, CIO). Называй их так, как они',
    'называются в вакансиях, а не описанием обязанностей и не фразой из резюме.',
    ...(language === 'ru'
      ? [
          'Названия ролей давай по-русски — так, как их пишут в русских вакансиях.',
          'Если устоявшегося русского названия у роли нет, не переводи его:',
          'оставь английское, как его пишет рынок (DevOps Engineer, SRE, QA).',
        ]
      : ['Названия ролей давай по-английски — так, как их пишут в вакансиях.']),
    'Каждая роль — короткое название должности (до 60 символов).',
    'Для каждой роли дай titleRu — как эту должность пишут в русских вакансиях;',
    'аббревиатуры из названия (COO, CTO, AI, IT) сохрани, остальное переведи',
    '(AI Consultant → AI-консультант). Если title уже по-русски,',
    'повтори его в titleRu.',
    'Название компании, продукта, подразделения или бренда из фактов — не роль:',
    'работодатель кандидата никогда не становится названием должности.',
    'Для каждой роли объясни в одном предложении, что именно в фактах кандидата',
    'её породило, и перечисли ссылки на эти факты из поля ref.',
    'Роль опирается на направление опыта: место работы или минимум два факта.',
    'Не называй роль по одному упоминанию технологии или навыка: строка вроде',
    '«работал со Swift» без работы в этой роли не делает кандидата iOS-разработчиком.',
    'Обоснование пиши по-русски независимо от языка названия роли.',
    'Запрещено: любые числа, проценты, оценки востребованности, зарплаты,',
    'слова «подходит», «не подходит», «уровень», «балл».',
    'Порядок ролей не важен: его определяет не ты.',
    'Формат ответа — ровно такой:',
    '{"roles":[{"title":"Product Manager","titleRu":"Продакт-менеджер",',
    '"reason":"девять лет вёл внутренние продукты","evidenceRefs":["memory:1"]}]}',
    'Имена полей именно эти: title, titleRu, reason, evidenceRefs.',
  ].join(' ');
}

/**
 * Бесплатная модель не держит имена полей: живой ответ
 * `nemotron-3-ultra:free` с прода 2026-09-03 пришёл голым массивом
 * `{role, explanation, refs}`. Просить строго и читать снисходительно дешевле,
 * чем терять названную роль из-за буквы; смысл при этом не размывается — поля
 * ровно те же три, и любое лишнее отбрасывается.
 */
const CYRILLIC = /[а-яё]/iu;
const TITLE_RU_MAX = 80;
/** «ИТ» и «ИИ» в русском названии — те же аббревиатуры, что «IT» и «AI». */
const CYRILLIC_ABBREVIATIONS: Readonly<Record<string, string>> = { IT: 'ИТ', AI: 'ИИ' };

/**
 * B748: русское название роли от модели берётся, только если оно правда русское,
 * короткое и не потеряло аббревиатур исходного (COO, AI): иначе показываем исходное.
 */
export function checkedTitleRu(title: string, titleRu: string | undefined): string | null {
  const text = titleRu?.trim() ?? '';
  if (!text || text.length > TITLE_RU_MAX || !CYRILLIC.test(text) || CYRILLIC.test(title))
    return null;
  const abbreviations = title.match(/\b[A-Z]{2,5}\b/gu) ?? [];
  const kept = abbreviations.every(
    (abbr) => text.includes(abbr) || text.includes(CYRILLIC_ABBREVIATIONS[abbr] ?? abbr),
  );
  return kept ? text : null;
}

const namedRoleSchema = z
  .object({
    title: z.string().trim().min(2).max(60).optional(),
    titleRu: z.string().max(200).optional(),
    role: z.string().trim().min(2).max(60).optional(),
    reason: z.string().trim().min(1).max(400).optional(),
    explanation: z.string().trim().min(1).max(400).optional(),
    evidenceRefs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    refs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .transform((value) => {
    const title = value.title ?? value.role ?? '';
    const titleRu = checkedTitleRu(title, value.titleRu);
    return {
      title,
      ...(titleRu ? { titleRu } : {}),
      reason: value.reason ?? value.explanation ?? '',
      evidenceRefs: value.evidenceRefs ?? value.refs ?? [],
    };
  })
  .refine((value) => value.title.length >= 2 && value.reason.length >= 1);

export const roleNamingSchema = z
  .union([z.object({ roles: z.array(namedRoleSchema).max(12) }), z.array(namedRoleSchema).max(12)])
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
          required: ['title', 'titleRu', 'reason', 'evidenceRefs'],
          properties: {
            title: { type: 'string' },
            titleRu: { type: 'string' },
            reason: { type: 'string' },
            evidenceRefs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

/**
 * Модель инструкции не всегда слушает: для профиля из LinkedIn она назвала
 * ролями «Accessibility Talent Solutions» и «Marketing Solutions» — продукты и
 * работодателей кандидата (PRB-039). Роль, чьё название совпадает с
 * организацией из резюме или содержит её целиком, до экрана не доходит.
 */
export function dropOrganisationTitles<T extends { readonly title: string }>(
  roles: readonly T[],
  organisations: readonly string[],
): T[] {
  const known = organisations
    .flatMap((organisation) => organisation.split(/\s*[·|/,]\s*/u))
    .map(normaliseName)
    .filter((name) => name.length >= 3);
  if (known.length === 0) return [...roles];
  return roles.filter((role) => {
    const title = normaliseName(role.title);
    return !known.some((name) => title === name || title.includes(name));
  });
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[«»"'()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
