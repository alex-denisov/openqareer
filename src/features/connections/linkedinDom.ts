/**
 * Tiny DOM helpers shared by the structured LinkedIn extractors (B265 §2/§5).
 * Parsing runs through the platform's own `DOMParser` (available in the
 * .app webview and, for tests, via jsdom) rather than a bespoke HTML reader.
 */

export function parseFragment(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Trimmed, whitespace-collapsed text content, or `undefined` when blank. */
export function textOf(el: Element | null | undefined): string | undefined {
  const text = el?.textContent?.replace(/\s+/gu, ' ').trim();
  return text && text.length > 0 ? text : undefined;
}

/** Direct `<p>` text of an element, in document order, non-empty only. */
export function paragraphsOf(root: Element): string[] {
  return Array.from(root.querySelectorAll('p'))
    .map((p) => textOf(p))
    .filter((text): text is string => Boolean(text));
}

const MEDIA_HOST = 'media.licdn.com';
const MEDIA_PATH = '/dms/image/';

/** A LinkedIn CDN image URL, restricted per architecture §2/§3. */
export function mediaSourceUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  try {
    const url = new URL(src);
    if (url.hostname !== MEDIA_HOST || !url.pathname.includes(MEDIA_PATH)) return undefined;
    return src;
  } catch {
    return undefined;
  }
}

/** Decodes LinkedIn's `linkedin.com/safety/go/?url=<encoded>` redirector. */
export function decodeSafetyGoUrl(href: string): string | undefined {
  try {
    const url = new URL(href);
    const isSafetyGo = /(^|\.)linkedin\.com$/u.test(url.hostname) && url.pathname.includes('/safety/go');
    const target = url.searchParams.get('url');
    // `searchParams.get` already decodes once; decoding again would unwrap a
    // double-encoded payload. Only a real https site survives.
    if (!isSafetyGo || !target) return undefined;
    return new URL(target).protocol === 'https:' ? target : undefined;
  } catch {
    return undefined;
  }
}
