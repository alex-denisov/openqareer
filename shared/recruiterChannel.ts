import { isHiringPlatform } from './hiringPlatforms';

/**
 * Каналы связи с рекрутёром (B258). Порядок — ценность для кандидата по
 * решению владельца 27.10: мессенджеры и телефон, затем почта, затем Instagram;
 * остальные каналы показываются, только если первых нет.
 */
export const PRIMARY_CHANNEL_KINDS = [
  'telegram',
  'whatsapp',
  'facebook',
  'viber',
  'phone',
  'email_personal',
  'email_corporate',
  'instagram',
] as const;

export const SECONDARY_CHANNEL_KINDS = [
  'linkedin',
  'vk',
  'x',
  'github',
  'skype',
  'website',
  'other',
] as const;

export type PrimaryChannelKind = (typeof PRIMARY_CHANNEL_KINDS)[number];
export type SecondaryChannelKind = (typeof SECONDARY_CHANNEL_KINDS)[number];
export type RecruiterChannelKind = PrimaryChannelKind | SecondaryChannelKind;

/**
 * - 'verified' — подтверждён (почта — почтовым сервером; профиль — именем и компанией на странице).
 * - 'published' — опубликован на открытой странице, где есть имя человека.
 * - 'hypothesis' — выведен (формула почты, ник), без прямого подтверждения.
 */
export type RecruiterChannelStatus = 'verified' | 'published' | 'hypothesis';

export interface RecruiterChannel {
  readonly kind: RecruiterChannelKind;
  readonly value: string;
  readonly href: string | null;
  readonly status: RecruiterChannelStatus;
  /** Внутренняя квитанция: открытая страница, где найден канал. Кандидату не отдаётся. */
  readonly sourceUrl: string | null;
  readonly observedAt: string;
}

export type CandidateRecruiterChannel = Omit<RecruiterChannel, 'sourceUrl'>;

const ORDER: readonly RecruiterChannelKind[] = [...PRIMARY_CHANNEL_KINDS, ...SECONDARY_CHANNEL_KINDS];
const STATUS_ORDER: readonly RecruiterChannelStatus[] = ['verified', 'published', 'hypothesis'];

export function isPrimaryChannel(kind: RecruiterChannelKind): boolean {
  return (PRIMARY_CHANNEL_KINDS as readonly string[]).includes(kind);
}

/** Сортировка по ценности канала, затем по надёжности; дубли (вид + значение) убираются. */
export function rankChannels(channels: readonly RecruiterChannel[]): RecruiterChannel[] {
  const unique = new Map<string, RecruiterChannel>();
  for (const channel of channels) {
    const key = `${channel.kind}:${channel.value.toLowerCase()}`;
    const known = unique.get(key);
    if (!known || STATUS_ORDER.indexOf(channel.status) < STATUS_ORDER.indexOf(known.status)) {
      unique.set(key, channel);
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
}

/** Что показать кандидату: все основные каналы; второстепенные — только если основных нет. */
export function candidateChannels(channels: readonly RecruiterChannel[]): CandidateRecruiterChannel[] {
  // Почта на домене площадки вакансий — ошибка определения домена компании, не канал человека.
  const ranked = rankChannels(channels).filter(
    (channel) => !channel.kind.startsWith('email_') || !isHiringPlatform(channel.value.split('@')[1] ?? ''),
  );
  const primary = ranked.filter((channel) => isPrimaryChannel(channel.kind));
  return (primary.length > 0 ? primary : ranked).map(({ sourceUrl: _internal, ...shown }) => shown);
}
