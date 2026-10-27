import type { RecruiterChannel, RecruiterChannelKind } from '../../../shared/recruiterChannel';

export interface ExtractContext {
  /** Домен почты компании: адреса на нём — корпоративные. */
  readonly companyDomain?: string;
  readonly sourceUrl: string | null;
  readonly observedAt: string;
}

/** Бесплатные почтовые службы: адрес на них — личная почта. */
const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de',
  'yandex.ru', 'ya.ru', 'yandex.com', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
]);

/** Ящики без человека за ними — канал не к рекрутёру. */
const ROLE_MAILBOX = /^(no-?reply|do-?not-?reply|info|support|help|press|media|privacy|legal|abuse|webmaster|admin|sales|marketing|billing)$/iu;

/** Служебные пути соцсетей — это не профиль человека. */
const SOCIAL_RESERVED = new Set([
  'sharer', 'share', 'sharer.php', 'dialog', 'plugins', 'p', 'reel', 'reels', 'explore', 'stories',
  'tr', 'login', 'groups', 'pages', 'events', 'watch', 'hashtag', 'intent', 'home', 'search',
  'joinchat', 's', 'feed', 'wall', 'away.php', 'share.php', 'i', 'policies', 'help', 'about',
]);

type Build = (match: RegExpMatchArray) => { value: string; href: string } | null;

function handle(raw: string | undefined): string | null {
  const value = (raw ?? '').replace(/\/$/u, '');
  return value && !SOCIAL_RESERVED.has(value.toLowerCase()) ? value : null;
}

function social(base: string): Build {
  return (match) => {
    const value = handle(match[1]);
    if (!value) return null;
    // Кириллический адрес профиля приходит закодированным: кандидат видит буквы, ссылка остаётся рабочей.
    let shown = value;
    try {
      shown = decodeURIComponent(value);
    } catch {
      // Битая кодировка — показываем как есть.
    }
    return { value: shown, href: `${base}${value}` };
  };
}

function digits(raw: string): string {
  return `+${decodeURIComponent(raw).replace(/\D/gu, '')}`;
}

const PATTERNS: ReadonlyArray<readonly [RecruiterChannelKind, RegExp, Build]> = [
  ['telegram', /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z][A-Za-z0-9_]{3,31})\b/gu,
    (m) => { const v = handle(m[1]); return v ? { value: `@${v}`, href: `https://t.me/${v}` } : null; }],
  ['whatsapp', /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)\+?(\d{10,15})/gu,
    (m) => ({ value: digits(m[1]), href: `https://wa.me/${m[1]}` })],
  ['viber', /viber:\/\/(?:chat|add)\?number=((?:%2B|\+)?\d{10,15})/giu,
    (m) => ({ value: digits(m[1]), href: `viber://chat?number=${encodeURIComponent(digits(m[1]))}` })],
  ['facebook', /(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.com\/([A-Za-z0-9.]{3,60})(?=[\s/?"')]|$)/gu,
    social('https://www.facebook.com/')],
  ['instagram', /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})(?=[\s/?"')]|$)/gu,
    social('https://www.instagram.com/')],
  ['vk', /(?:https?:\/\/)?(?:www\.|m\.)?vk\.com\/([A-Za-z0-9._]{3,40})(?=[\s/?"')]|$)/gu, social('https://vk.com/')],
  ['x', /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,15})(?=[\s/?"')]|$)/gu, social('https://x.com/')],
  ['linkedin', /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]{3,100})/gu,
    social('https://www.linkedin.com/in/')],
  ['github', /(?:https?:\/\/)?github\.com\/([A-Za-z0-9-]{2,39})(?=[\s/?"')]|$)/gu, social('https://github.com/')],
  ['skype', /skype:([A-Za-z0-9._:-]{4,64})\?/gu, (m) => ({ value: m[1], href: `skype:${m[1]}?chat` })],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const PHONE = /(?<![\w/=])\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3}[\s-]?\d{2,4}(?:[\s-]?\d{2})?(?![\w])/gu;

function emailKind(email: string, companyDomain?: string): RecruiterChannelKind | null {
  const [local, domain = ''] = email.toLowerCase().split('@');
  if (!local || ROLE_MAILBOX.test(local)) return null;
  if (PERSONAL_MAIL_DOMAINS.has(domain)) return 'email_personal';
  if (companyDomain && (domain === companyDomain || domain.endsWith(`.${companyDomain}`))) return 'email_corporate';
  // Без домена компании нельзя сказать, что адрес рабочий: не берём.
  return null;
}

/**
 * Каналы, опубликованные на одной открытой странице. Вызывающий отвечает
 * за то, что страница относится к человеку (на ней есть его имя).
 */
export function extractChannels(text: string, context: ExtractContext): RecruiterChannel[] {
  const found: RecruiterChannel[] = [];
  const add = (kind: RecruiterChannelKind, value: string, href: string | null) => {
    found.push({ kind, value, href, status: 'published', sourceUrl: context.sourceUrl, observedAt: context.observedAt });
  };
  for (const [kind, pattern, build] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const built = build(match);
      if (built) add(kind, built.value, built.href);
    }
  }
  for (const [email] of text.matchAll(EMAIL)) {
    const kind = emailKind(email, context.companyDomain);
    if (kind) add(kind, email.toLowerCase(), `mailto:${email.toLowerCase()}`);
  }
  const messengerNumbers = new Set(found.filter((c) => c.kind === 'whatsapp' || c.kind === 'viber').map((c) => c.value));
  for (const [raw] of text.matchAll(PHONE)) {
    const phone = raw.trim();
    const normalized = `+${phone.replace(/\D/gu, '')}`;
    if (normalized.length < 11 || messengerNumbers.has(normalized)) continue;
    add('phone', phone, `tel:${normalized}`);
  }
  const seen = new Set<string>();
  return found.filter((channel) => {
    const key = `${channel.kind}:${channel.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
