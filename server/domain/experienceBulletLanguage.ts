/**
 * A proposal the candidate is already looking at stays on the draft by the
 * digest of its input (29.10), so a profile written in English could keep a
 * proposal the consultant wrote in Russian before 01.11. The owner will not
 * accept bullets in a language other than the profile's: such a proposal is
 * translated, not written anew. Only the text changes; every bullet keeps its
 * source facts by construction, and the translator is told to soften, never
 * strengthen, a claim its facts do not carry.
 */
import { z } from 'zod';
import {
  bulletKey,
  checkedBullet,
  type FactRewriteProposal,
  type FactRewriteRequest,
} from './experienceFactRewrite';
import { textLanguage, type ProfileLanguage } from './profileLanguage';

export { placeLanguages, textLanguage, type ProfileLanguage } from './profileLanguage';

export interface BulletToTranslate {
  /** `experienceId#index` of the bullet in the proposal. */
  readonly key: string;
  readonly language: ProfileLanguage;
  readonly text: string;
  /** Statements of the bullet's source facts: the translation may not claim more. */
  readonly facts: readonly string[];
}

export interface BulletTranslationRequest {
  readonly bullets: readonly BulletToTranslate[];
}

export const bulletTranslationOutputSchema = z.object({
  bullets: z.array(z.object({ key: z.string().max(200), text: z.string().max(1_000) })).max(120),
});

export type BulletTranslationOutput = z.infer<typeof bulletTranslationOutputSchema>;

export const BULLET_TRANSLATION_PROMPT_REVISION = 'experience-bullet-translation-2026-11-01';

export const BULLET_TRANSLATION_INSTRUCTIONS = `Ты карьерный консультант и редактор резюме. Ниже пункты для блока «Опыт», которые консультант уже предложил кандидату, и факты из беседы, из которых собран каждый пункт. Пункты написаны не на языке профиля. Переведи каждый пункт на язык из поля language: "en" — английский, "ru" — русский.

Правила:
1. Сохрани смысл пункта и опирайся на его факты. Ничего не добавляй.
2. Не усиливай утверждения. Если пункт говорит больше, чем подтверждают его факты, смягчи его до того, что факты подтверждают: команды, перешедшие из других подразделений, — не «вырастил команду»; обязанности подчинённых — не личные заслуги кандидата; «примерно», «по-моему», «около» сохраняй как «about», «around»; участие — не «организовал».
3. Стиль достижений: одно предложение, начинается с глагола в прошедшем времени (по-английски «Reduced…», «Built…», «Led…»). Без I, we, my, our и без «я», «мы».
4. Числа — только те, что есть в фактах, и цифрами. Не пиши чисел, которых в фактах нет: не «24/7», а «round-the-clock»; не «L1/L2», а «first- and second-line»; не «2x», если в фактах нет двойки.
5. Названия компаний, продуктов и технологий оставь как в пункте, русские названия передай латиницей («Россети Цифра» → «Rosseti Tsifra»). Сокращения РТО, РПО пиши как RTO, RPO.
6. Пункт не длиннее 250 знаков.

Ответь только JSON: {"bullets":[{"key":"...","text":"..."}]} — ровно по одному пункту на каждый key из запроса.`;

export const BULLET_TRANSLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bullets'],
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text'],
        properties: { key: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

export function bulletTranslationUserMessage(request: BulletTranslationRequest): string {
  return `<bullets>\n${JSON.stringify(request, null, 1)}\n</bullets>`;
}

/** The bullets of the proposal written in a language other than their place's, or `null`. */
export function pendingTranslation(
  proposal: FactRewriteProposal,
  request: FactRewriteRequest,
): BulletTranslationRequest | null {
  const languages = new Map(request.places.map((place) => [place.experienceId, place.language]));
  const statements = new Map(request.facts.map((fact) => [fact.id, fact.statement]));
  const bullets = proposal.places.flatMap((place) => {
    const language = languages.get(place.experienceId);
    if (!language) return [];
    return place.bullets.flatMap((bullet, index) => {
      const written = textLanguage(bullet.text);
      if (!written || written === language) return [];
      return [
        {
          key: bulletKey(place.experienceId, index),
          language,
          text: bullet.text,
          facts: bullet.sourceFactIds.map((id) => statements.get(id) ?? '').filter(Boolean),
        },
      ];
    });
  });
  return bullets.length ? { bullets } : null;
}

/**
 * The proposal with the translated text under a new id, or `null` when any
 * bullet came back missing or failed the checks a fresh bullet must pass:
 * a half-translated proposal is not shown.
 */
export function applyBulletTranslation(
  proposal: FactRewriteProposal,
  pending: BulletTranslationRequest,
  output: BulletTranslationOutput,
  id: string,
): FactRewriteProposal | null {
  const wanted = new Map(pending.bullets.map((bullet) => [bullet.key, bullet]));
  const answered = new Map(output.bullets.map((bullet) => [bullet.key, bullet.text]));
  const translated = new Map<string, string>();
  for (const [key, bullet] of wanted) {
    const text = answered.get(key);
    if (!text) return null;
    const sources = new Map(bullet.facts.map((fact, index) => [String(index), fact]));
    const checked = checkedBullet(
      { text, sourceFactIds: [...sources.keys()] },
      sources,
      bullet.language,
    );
    if (!checked || textLanguage(checked.text) !== bullet.language) return null;
    translated.set(key, checked.text);
  }
  return {
    ...proposal,
    id,
    places: proposal.places.map((place) => ({
      ...place,
      bullets: place.bullets.map((bullet, index) => {
        const text = translated.get(bulletKey(place.experienceId, index));
        return text ? { ...bullet, text } : bullet;
      }),
    })),
  };
}
