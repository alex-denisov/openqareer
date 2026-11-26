import {
  VARIANT_WISH_CHIPS,
  VARIANT_WISH_MAX_LENGTH,
  type VariantWish,
  type VariantWishChip,
} from '../../shared/textVariants';

const CHIP_INSTRUCTIONS: Readonly<Record<VariantWishChip, string>> = {
  shorter: 'сделай текст заметно короче',
  warmer: 'сделай тон теплее и человечнее',
  formal: 'сделай тон официальнее',
  numbers: 'покажи больше цифр — только тех, что уже есть в профиле',
};

/** Пожелание кандидата: известные чипы без повторов и текст без служебных символов. */
export function normalizeWish(input: { readonly chips?: readonly string[]; readonly text?: string } | undefined): VariantWish {
  const chips = VARIANT_WISH_CHIPS.filter((chip) => input?.chips?.includes(chip));
  const text = (input?.text ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/["«»“”]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, VARIANT_WISH_MAX_LENGTH);
  return { chips, text };
}

/**
 * Пожелание как добавка к запросу на текст. Слова кандидата идут цитатой и не отменяют
 * правил: факты только из профиля, новых цифр и имён не появляется.
 */
export function wishInstruction(wish: VariantWish): string {
  const parts = wish.chips.map((chip) => CHIP_INSTRUCTIONS[chip]);
  const asked = [
    parts.length > 0 ? `${parts.join('; ')}.` : '',
    wish.text ? `Своими словами кандидат просит: «${wish.text}».` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    'Это другой вариант того же текста: напиши его заново, другими словами.',
    asked ? `Пожелание кандидата к этому варианту: ${asked}` : '',
    'Пожелание меняет только подачу. Факты, цифры и имена — только из профиля; новых не добавляй. Остальные требования остаются в силе.',
  ]
    .filter(Boolean)
    .join('\n');
}
