import { vacancyBoardName } from '../../../../shared/vacancyBoards';
import { platformOf } from '../responses/model/platform';

/** Ссылка вакансии и её источники: что нужно, чтобы назвать кнопку тем, куда она ведёт. */
export interface SourceLinkInput {
  readonly primaryUrl: string;
  readonly sources: readonly {
    readonly sourceType?: string;
    readonly sourceId?: string;
    readonly sourceName?: string;
    readonly sourceUrl: string;
  }[];
  readonly canonicalCompany?: string | null;
  /** Ссылка, которую называем; по умолчанию основная (`primaryUrl`). */
  readonly url?: string;
}

/** Куда ведёт ссылка: пост Telegram, сайт работодателя или источник вакансии (`name` — его имя). */
export type SourceLinkTarget =
  | { readonly kind: 'telegram' }
  | { readonly kind: 'employer' }
  | { readonly kind: 'source'; readonly name: string | null };

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me']);

function parsed(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** Ленты freehire, которые ведут на площадку; остальные `src-fh-…` — карьерные сайты компаний. */
const FREEHIRE_ID = /^src-fh-/u;

function boardName(url: URL | undefined, sourceId: string | undefined): string | null {
  const byHost = url ? vacancyBoardName(url.hostname) : null;
  if (byHost || !sourceId || !FREEHIRE_ID.test(sourceId)) return byHost;
  const platform = platformOf(sourceId);
  return platform.site ? null : platform.label;
}

/** Источник этой ссылки: по адресу как есть или после разбора (`URL` дописывает «/»). */
function sourceOf(input: SourceLinkInput, link: string, url: URL | undefined) {
  const href = url?.toString();
  return input.sources.find(
    (source) =>
      source.sourceUrl === link ||
      (href !== undefined && parsed(source.sourceUrl)?.toString() === href),
  );
}

/**
 * B726 (B645, прод 23.11): «сайт работодателя» — только когда ссылка правда у работодателя.
 * Пост Telegram называется постом; без компании ссылка ведёт на источник — его именем.
 */
export function sourceLinkTarget(input: SourceLinkInput): SourceLinkTarget {
  const link = input.url ?? input.primaryUrl;
  const url = parsed(link);
  const source = sourceOf(input, link, url);
  const telegram =
    (url && TELEGRAM_HOSTS.has(url.hostname)) ||
    source?.sourceType === 'telegram' ||
    /^tg-/u.test(source?.sourceId ?? '');
  if (telegram) return { kind: 'telegram' };
  // B801: агрегатор — площадка со своим именем, а не сайт работодателя.
  const board = boardName(url, source?.sourceId);
  if (board) return { kind: 'source', name: board };
  if (input.canonicalCompany?.trim()) return { kind: 'employer' };
  const name = source?.sourceName?.trim() || url?.hostname.replace(/^www\./u, '');
  return { kind: 'source', name: name || null };
}

export function sourceLinkLabel(input: SourceLinkInput): string {
  const target = sourceLinkTarget(input);
  if (target.kind === 'telegram') return 'Открыть пост в Telegram';
  if (target.kind === 'employer') return 'Открыть на сайте работодателя';
  return target.name ? `Открыть на ${target.name}` : 'Открыть вакансию';
}
