/**
 * Базы контактов и «форматы почты»: сайты, которые публикуют чужие почты и телефоны.
 * Это чужая сборка, а не публикация человека или компании: в сведениях о рекрутёре такой
 * источник не берётся, в цифровом следе кандидата он всегда риск (B382).
 */
export const CONTACT_BROKERS: readonly string[] = [
  'clay.com',
  'rocketreach.co',
  'zoominfo.com',
  'leadiq.com',
  'signalhire.com',
  'contactout.com',
  'hunter.io',
  'apollo.io',
  'lusha.com',
  'email-format.com',
  'emailformat.net',
  'adapt.io',
  'snov.io',
  'skrapp.io',
  'voilanorbert.com',
  'peopledatalabs.com',
  'spokeo.com',
  'whitepages.com',
  'truepeoplesearch.com',
  'beenverified.com',
  'radaris.com',
  'nuwber.com',
  'datanyze.com',
  'uplead.com',
  'kaspr.io',
  'getprospect.com',
  'findemails.com',
  'emailsherlock.com',
  'aeroleads.com',
  'salesql.com',
  'lead411.com',
  'seamless.ai',
  'wiza.co',
];

/** Адрес ведёт в базу контактов; `null` — адреса нет или он не разбирается. */
export function contactBrokerUrl(url: string | null | undefined): boolean | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./u, '').toLowerCase();
    return (
      CONTACT_BROKERS.some((site) => host === site || host.endsWith(`.${site}`)) ||
      /email[-_]?format/iu.test(url)
    );
  } catch {
    return null;
  }
}
