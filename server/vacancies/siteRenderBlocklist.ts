/**
 * B643: хосты аналитики, рекламы, пикселей и баннеров согласия. Рендеру они
 * не нужны: список вакансий от них не зависит, а каждый такой запрос — новое
 * TLS-соединение и время из бюджета страницы (прод 11.11: 6 из 6 рендеров
 * упёрлись в таймаут). Совпадение по домену и его поддоменам.
 */
const TRACKER_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  // Meta, LinkedIn, X, TikTok, Pinterest, Reddit, Bing
  'facebook.net',
  'facebook.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'ads-twitter.com',
  'analytics.twitter.com',
  'analytics.tiktok.com',
  'ct.pinterest.com',
  'redditstatic.com',
  'bat.bing.com',
  'clarity.ms',
  // Рунет
  'mc.yandex.ru',
  'mc.yandex.com',
  'mc.yandex.by',
  'mc.yandex.kz',
  'top-fwz1.mail.ru',
  'counter.yadro.ru',
  'vk.com',
  'mc.webvisor.org',
  // Аналитика продукта и записи сессий
  'hotjar.com',
  'hotjar.io',
  'cdn.segment.com',
  'mixpanel.com',
  'amplitude.com',
  'fullstory.com',
  'mouseflow.com',
  'heap.io',
  'heapanalytics.com',
  'quantserve.com',
  'scorecardresearch.com',
  'newrelic.com',
  'nr-data.net',
  'go-mpulse.net',
  'cloudflareinsights.com',
  'matomo.cloud',
  'plausible.io',
  // Маркетинг и чаты
  'hs-scripts.com',
  'hs-analytics.net',
  'hsadspixel.net',
  'hubspot.com',
  'widget.intercom.io',
  'js.driftt.com',
  'marketo.net',
  'pardot.com',
  'adroll.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  // Баннеры согласия на cookie
  'usercentrics.eu',
  'cookiebot.com',
  'cookielaw.org',
  'onetrust.com',
  'consensu.org',
  'trustarc.com',
  'didomi.io',
]);

export function isTrackerHost(host: string): boolean {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  for (let start = 0; start < labels.length - 1; start += 1) {
    if (TRACKER_DOMAINS.has(labels.slice(start).join('.'))) return true;
  }
  return false;
}
