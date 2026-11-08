/**
 * B617: материалы живут в двух коллекциях с одним шаблоном — опорные /guides
 * и статьи /blog. Коллекция задаёт корень адреса и подписи крошек.
 */
export interface GuideCollection {
  /** Корень адреса: `/guides`, `/blog`. */
  readonly root: string;
  /** Название хаба для H1 и JSON-LD. */
  readonly hubName: string;
  /** Короткая подпись в хлебных крошках. */
  readonly crumb: string;
  /** Подпись карточки в блоке «Читайте также». */
  readonly kind: string;
}

export const GUIDES_COLLECTION: GuideCollection = {
  root: '/guides',
  hubName: 'Материалы для кандидата',
  crumb: 'Материалы',
  kind: 'Материал',
};

export const BLOG_COLLECTION: GuideCollection = {
  root: '/blog',
  hubName: 'Блог openqareer: разборы для кандидатов',
  crumb: 'Блог',
  kind: 'Статья',
};

export function collectionPath(collection: GuideCollection, slug: string): string {
  return `${collection.root}/${slug}`;
}
