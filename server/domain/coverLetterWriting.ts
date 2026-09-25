import { z } from 'zod';
import type { PitchLanguage, PitchTone } from './vacancyPitchService';

/**
 * Сопроводительное письмо пишет модель, шаблон остаётся запасом (B266,
 * пункт 7). Инструкция запрещает то, что шаблон уже не допускает: домыслы о
 * работодателях и цифрах, служебный текст об импорте и подборе, и заглушки
 * вида «[Имя]», которые кандидат не заметит перед отправкой рекрутеру.
 */
export const COVER_LETTER_MAX_CHARS = 1800;

const TONE_HINT: Record<PitchTone, { ru: string; en: string }> = {
  executive: {
    ru: 'Тон — деловой и сдержанный, для руководителя направления.',
    en: 'Tone: business-like and measured, addressed to a hiring lead.',
  },
  confident: {
    ru: 'Тон — уверенный, прямой, без излишней скромности.',
    en: 'Tone: confident and direct, without false modesty.',
  },
  technical: {
    ru: 'Тон — технический, с акцентом на инженерные детали.',
    en: 'Tone: technical, focused on engineering detail.',
  },
};

/**
 * Язык и тон выбирает код, не модель — та же причина, что и у называния
 * ролей: смена провайдера не должна переписывать кандидату письмо на другом
 * языке (`roleNaming.ts`).
 */
export function coverLetterInstructions(language: PitchLanguage, tone: PitchTone): string {
  const hint = TONE_HINT[tone][language];
  return [
    'Ты пишешь сопроводительное письмо кандидата по вакансии от первого лица.',
    'Используй только факты, перечисленные во входных данных — ничего не выдумывай:',
    'ни работодателей, ни цифр, ни навыков, которых там нет.',
    'Не упоминай, что данные пришли из импорта резюме, подбора вакансий или от ассистента —',
    'письмо адресовано рекрутеру, а не описывает, как оно собрано.',
    'Не упоминай требования вакансии, которых кандидат не подтвердил.',
    'Не оставляй заглушек вида [Имя], [Компания] или любых квадратных скобок — пиши прямым текстом.',
    'Не используй markdown, списки или заголовки — только обычные абзацы.',
    `Пиши на языке: ${language === 'ru' ? 'русском' : 'английском'}.`,
    hint,
    `Уложись в ${COVER_LETTER_MAX_CHARS} символов.`,
    'Ответь только JSON по схеме, без пояснений вокруг: {"body":"текст письма"}.',
  ].join(' ');
}

export const coverLetterBodySchema = z.object({
  body: z.string().trim().min(1).max(COVER_LETTER_MAX_CHARS),
});

export type CoverLetterBody = z.infer<typeof coverLetterBodySchema>;

export const COVER_LETTER_JSON_SCHEMA = {
  name: 'cover_letter',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: {
      body: { type: 'string' },
    },
  },
} as const;
