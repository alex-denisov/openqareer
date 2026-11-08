/**
 * B616: опорные публичные материалы (pillar) — разбор боли кандидата со ссылкой
 * на механику openqareer. Один формат для всех материалов, чтобы будущий блог
 * переиспользовал шаблон, а не копировал страницы.
 */

/** Внешний источник цифры или утверждения. Цифра без источника не печатается. */
export interface GuideSource {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  /** Дата публикации или обращения, ISO. */
  readonly date: string;
}

/** Ссылка на механику openqareer или публичный инструмент. */
export interface GuideAction {
  readonly label: string;
  /** Путь сайта (`/signup`, `/tools/resume`, `/tariffs`). */
  readonly href: string;
  /** Что именно делает механика, одной фразой, без обещаний результата. */
  readonly note: string;
  /** Механика доступна только после входа. */
  readonly signedIn: boolean;
}

export type GuideBlock =
  | { readonly kind: 'paragraph'; readonly text: string; readonly sourceIds?: readonly string[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'checklist'; readonly title: string; readonly items: readonly string[] }
  | {
      readonly kind: 'example';
      /** «Пример: бухгалтер» */
      readonly title: string;
      readonly text: string;
      /** Почему пример работает — разбор под текстом. */
      readonly why?: string;
    }
  | { readonly kind: 'compare'; readonly weak: string; readonly strong: string };

export interface GuideSection {
  /** id для якоря и оглавления: латиница через дефис. */
  readonly id: string;
  readonly title: string;
  /** Надпись над заголовком секции: «Причина 1». */
  readonly kicker?: string;
  /** Короткое описание симптома: «как понять, что причина в этом». */
  readonly symptom?: string;
  readonly blocks: readonly GuideBlock[];
  /** Механика openqareer, которая решает эту причину. */
  readonly action?: GuideAction;
}

export interface GuideFaq {
  readonly question: string;
  readonly answer: string;
}

export interface Guide {
  /** Сегмент адреса `/guides/<slug>`. */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  /** Короткое имя для хлебных крошек. */
  readonly crumb: string;
  /** Короткая надпись над H1. */
  readonly eyebrow: string;
  /** Хук первого экрана: 1–2 предложения. */
  readonly lead: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  /** Главный вход первого экрана. */
  readonly primaryAction: GuideAction;
  readonly sections: readonly GuideSection[];
  readonly faq: readonly GuideFaq[];
  readonly sources: readonly GuideSource[];
  /** Слаги других материалов и путей инструментов для блока «Читайте также». */
  readonly related: readonly string[];
  /** Ключевые фразы Вордстата, под которые написан материал (не печатаются). */
  readonly queries: readonly string[];
}
