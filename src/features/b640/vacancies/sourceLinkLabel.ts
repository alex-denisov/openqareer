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
}

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me']);

function parsed(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isTelegram(url: URL, input: SourceLinkInput): boolean {
  if (TELEGRAM_HOSTS.has(url.hostname)) return true;
  return input.sources.some(
    (source) =>
      source.sourceUrl === input.primaryUrl &&
      (source.sourceType === 'telegram' || /^tg-/u.test(source.sourceId ?? '')),
  );
}

/**
 * B726 (B645, прод 23.11): «сайт работодателя» — только когда ссылка правда у работодателя.
 * Пост Telegram называется постом; без компании ссылка ведёт на источник — его именем.
 */
export function sourceLinkLabel(input: SourceLinkInput): string {
  const url = parsed(input.primaryUrl);
  if (url && isTelegram(url, input)) return 'Открыть пост в Telegram';
  if (input.canonicalCompany?.trim()) return 'Открыть на сайте работодателя';
  const named = input.sources
    .find((source) => source.sourceUrl === input.primaryUrl)
    ?.sourceName?.trim();
  const name = named || url?.hostname.replace(/^www\./u, '');
  return name ? `Открыть на ${name}` : 'Открыть вакансию';
}
