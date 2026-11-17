/**
 * B682: «Другой вариант». У одного текста (письмо, пост, комментарий, заголовок, сообщение,
 * резюме) — не больше трёх перегенераций. К варианту можно добавить пожелание «Что поменять».
 * Перегенерация не расходует месячную квоту: предел считается здесь же.
 */

export const TEXT_VARIANT_KINDS = ['letter', 'resume', 'post', 'comment', 'headline', 'message'] as const;
export type TextVariantKind = (typeof TEXT_VARIANT_KINDS)[number];

/** Сколько других вариантов можно получить у одного текста. */
export const MAX_TEXT_VARIANTS = 3;
export const VARIANT_WISH_MAX_LENGTH = 300;

export const VARIANT_WISH_CHIPS = ['shorter', 'warmer', 'formal', 'numbers'] as const;
export type VariantWishChip = (typeof VARIANT_WISH_CHIPS)[number];

export const VARIANT_WISH_LABELS: Readonly<Record<VariantWishChip, string>> = {
  shorter: 'Короче',
  warmer: 'Теплее',
  formal: 'Официальнее',
  numbers: 'Больше цифр',
};

export interface VariantWish {
  readonly chips: readonly VariantWishChip[];
  /** Пожелание своими словами. */
  readonly text: string;
}

export interface TextVariant<Payload = unknown> {
  readonly id: string;
  /** Номер варианта у этого текста, с единицы. */
  readonly position: number;
  readonly text: string;
  readonly wish: VariantWish;
  readonly createdAt: string;
  /** Данные текста своего вида: у письма — тема, подпись и текст для знакомого. */
  readonly payload: Payload | null;
}

export interface TextVariantList<Payload = unknown> {
  readonly variants: readonly TextVariant<Payload>[];
  /** Сколько ещё вариантов можно получить. */
  readonly remaining: number;
}

/** Данные варианта письма: то, из чего экран собирает текст для выбранного адресата. */
export interface LetterVariantPayload {
  readonly emailPitch: { readonly subject: string; readonly body: string };
  readonly contactMessage?: string;
  readonly senderName?: string;
  readonly senderFirstName?: string;
}
