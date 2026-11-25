import type { B640PersonMessage } from '../../../../../shared/b640Companies';
import { isHhHost, isHhSource } from '../../../../../shared/hhVacancySource';
import { pluralRu } from '../../../../../shared/pluralRu';
import type { IconName } from '../../kit';
import { sourceLinkLabel, sourceLinkTarget } from '../sourceLinkLabel';

export type WayAction =
  | {
      readonly kind: 'compose';
      readonly label: string;
      /** Полное имя адресата: заголовок шага «Отклик» (a02d). */
      readonly recipient: string;
      readonly message: B640PersonMessage;
    }
  | { readonly kind: 'letter'; readonly label: string }
  | { readonly kind: 'external'; readonly label: string; readonly url: string };

export type ComposeAction = Extract<WayAction, { readonly kind: 'compose' }>;

export interface ApplyWay {
  readonly id: 'friend' | 'hh' | 'site';
  readonly title: string;
  /** Подпись под названием: круг и путь до знакомого. */
  readonly sub?: string;
  readonly recommended?: boolean;
  readonly icon: IconName;
  /** Нет у знакомого, которому сервер не готовит черновик (`message: null`). */
  readonly action?: WayAction;
}

export interface WaysInput {
  readonly sources: readonly {
    readonly sourceType: string;
    readonly sourceId?: string;
    readonly sourceName?: string;
    readonly sourceUrl: string;
  }[];
  readonly primaryUrl: string;
  /** Знакомый 1-го круга: имя, подпись пути, надпись кнопки и адресат черновика. */
  readonly friend?: {
    readonly name: string;
    readonly sub: string;
    readonly label: string;
    readonly message: B640PersonMessage | null;
  };
  /** Вопросов в анкете работодателя; `undefined` — анкеты нет или её не прочитали. */
  readonly questionCount?: number;
  /** Компания вакансии; пустая или `null` — источник не назвал работодателя. */
  readonly company: string | null;
}

function safeUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function siteUrl(input: WaysInput): string | undefined {
  const candidates = [
    ...input.sources.filter((source) => !isHhSource(source)).map((source) => source.sourceUrl),
    input.primaryUrl,
  ];
  for (const candidate of candidates) {
    const url = safeUrl(candidate);
    if (url && !isHhHost(url.hostname)) return url.toString();
  }
  return undefined;
}

/**
 * B726: название и надпись ссылки — те же, что в меню строки (`sourceLinkLabel`): «Сайт
 * компании» — только у работодателя, пост Telegram — постом, иначе имя источника.
 */
function linkWay(url: URL, input: WaysInput): ApplyWay {
  const href = url.toString();
  const link = { ...input, url: href, canonicalCompany: input.company };
  const target = sourceLinkTarget(link);
  const title =
    target.kind === 'telegram'
      ? 'Пост в Telegram'
      : target.kind === 'employer'
        ? 'Сайт компании'
        : (target.name ?? url.hostname);
  return {
    id: 'site',
    title,
    icon: 'out',
    action: { kind: 'external', label: sourceLinkLabel(link), url: href },
  };
}

function siteWay(input: WaysInput): ApplyWay | undefined {
  if (input.questionCount) {
    return {
      id: 'site',
      title: `Сайт компании — анкета из ${pluralRu(input.questionCount, ['вопроса', 'вопросов', 'вопросов'])}`,
      icon: 'file',
      action: { kind: 'letter', label: 'Заполнить анкету' },
    };
  }
  const url = siteUrl(input);
  return url ? linkWay(new URL(url), input) : undefined;
}

/** Способы отклика по порядку макета: знакомый (рекомендуем), hh.ru, сайт. Только известные по вакансии. */
export function applyWays(input: WaysInput): readonly ApplyWay[] {
  const hh: ApplyWay | undefined = input.sources.some(isHhSource)
    ? {
        id: 'hh',
        title: 'hh.ru — письмо и ваше резюме',
        icon: 'responses',
        action: { kind: 'letter', label: 'Откликнуться на hh.ru' },
      }
    : undefined;
  const friend: ApplyWay | undefined = input.friend
    ? {
        id: 'friend',
        title: `Через знакомого — ${input.friend.name}`,
        sub: input.friend.sub,
        recommended: true,
        icon: 'users',
        ...(input.friend.message
          ? {
              action: {
                kind: 'compose',
                label: input.friend.label,
                recipient: input.friend.name,
                message: input.friend.message,
              },
            }
          : {}),
      }
    : undefined;
  return [friend, hh, siteWay(input)].filter((way): way is ApplyWay => way !== undefined);
}

/** Вакансия на площадке — когда её текста нет и ни один способ отклика туда не ведёт (B800). */
export function sourceLinkOf(
  input: Pick<WaysInput, 'primaryUrl'>,
  ways: readonly ApplyWay[],
): { readonly url: string; readonly label: string } | undefined {
  if (ways.some((way) => way.action?.kind === 'external')) return undefined;
  const url = safeUrl(input.primaryUrl);
  if (!url) return undefined;
  const name = isHhHost(url.hostname) ? 'hh.ru' : url.hostname.replace(/^www\./u, '');
  return { url: url.toString(), label: `Открыть на ${name}` };
}
