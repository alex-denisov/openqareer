export type TariffTier = 'free' | 'pro' | 'executive';
export const TARIFF_BENEFITS = [
  { id: 'comment_drafts', title: 'Черновики комментариев — 3 в день', includedIn: ['pro'] },
  { id: 'post_drafts', title: 'Черновики постов и комментариев', includedIn: ['executive'] },
] as const;
export const TARIFF_PLANS = {
  free: { name: 'Базовый', summary: 'Работа с профилем и вакансиями.', badge: '' },
  pro: { name: 'Pro', summary: 'Подготовка комментариев по вашей теме.', badge: '' },
  executive: { name: 'Executive', summary: 'До 5 комментариев и 2 постов в день.', badge: '' },
};
