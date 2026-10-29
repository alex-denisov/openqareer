import { parseFragment, textOf } from './linkedinDom';
import type { LinkedInConnectionImportContact } from '../outreach/connectionContactsApi';

/**
 * Reads the candidate's 1st-degree connections list (B448). The parser keys
 * on what any version of the page must carry — one `/in/<slug>` link per
 * person — and reads the name and headline from that person's own card, so
 * it does not depend on LinkedIn's generated class names.
 */
export interface LinkedInConnection {
  readonly fullName: string;
  readonly headline: string;
  readonly linkedinUrl: string;
}

const PROFILE_PATH = /^\/in\/([^/?#]+)\/?$/u;
const NOISE_LINE = /^(сообщение|message|связь установлена|connected on|фото|photo|ещё|more)\b/iu;
// "Role at Company", "Role в Company", "Role @ Company"; the last separator wins.
const COMPANY_SEPARATOR = /\s+(?:at|в|во|@)\s+/giu;
const HEADLINE_TAIL = /\s*[|·•,]\s*/u;

export function extractLinkedInConnections(html: string): LinkedInConnection[] {
  const document = parseFragment(html);
  const seen = new Set<string>();
  const connections: LinkedInConnection[] = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const slug = profileSlug(anchor.getAttribute('href'));
    if (!slug || seen.has(slug)) continue;
    const person = personIn(ownCard(anchor, slug), slug);
    if (!person) continue;
    seen.add(slug);
    connections.push({ ...person, linkedinUrl: `https://www.linkedin.com/in/${slug}/` });
  }
  return connections;
}

export function companyFromHeadline(
  headline: string,
): { readonly roleTitle: string; readonly companyName: string } | null {
  const separators = Array.from(headline.matchAll(COMPANY_SEPARATOR));
  const last = separators.at(-1);
  if (!last || last.index === undefined) return null;
  const roleTitle = headline.slice(0, last.index).trim();
  const companyName = headline
    .slice(last.index + last[0].length)
    .split(HEADLINE_TAIL)[0]
    ?.trim();
  if (!companyName) return null;
  return { roleTitle: roleTitle.slice(0, 160), companyName: companyName.slice(0, 180) };
}

/**
 * Every connection is kept (owner, 29.10): a person whose headline names no
 * company keeps the headline as the role and an empty company. People with a
 * company come first, so a cap never drops the ones that place a circle.
 */
export function toConnectionImportContacts(
  connections: readonly LinkedInConnection[],
  limit: number,
): LinkedInConnectionImportContact[] {
  const contacts = connections.map((connection) => {
    const place = companyFromHeadline(connection.headline);
    return {
      fullName: connection.fullName.slice(0, 120),
      companyName: place?.companyName ?? '',
      roleTitle: place ? place.roleTitle : connection.headline.slice(0, 160),
      linkedinUrl: connection.linkedinUrl,
    };
  });
  return [
    ...contacts.filter((contact) => contact.companyName),
    ...contacts.filter((contact) => !contact.companyName),
  ].slice(0, limit);
}

function profileSlug(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, 'https://www.linkedin.com');
    if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) {
      return undefined;
    }
    return PROFILE_PATH.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}

/** The widest ancestor whose profile links all point at this one person. */
function ownCard(anchor: Element, slug: string): Element {
  let card = anchor;
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const slugs = Array.from(parent.querySelectorAll('a[href]')).flatMap(
      (link) => profileSlug(link.getAttribute('href')) ?? [],
    );
    if (slugs.some((other) => other !== slug)) break;
    card = parent;
  }
  return card;
}

/**
 * The real page (23.10 capture) wraps the name and the headline in one
 * profile link: `<a href="/in/…"><p>name</p><div><p><span>headline</span></p></div></a>`,
 * with the photo link and the "Connected on" line beside it.
 */
function personIn(
  card: Element,
  slug: string,
): { readonly fullName: string; readonly headline: string } | undefined {
  const links = [card, ...Array.from(card.querySelectorAll('a[href]'))].filter(
    (link) => link.matches('a[href]') && profileSlug(link.getAttribute('href')) === slug,
  );
  for (const link of links) {
    const lines = textLines(link);
    const [fullName, headline = ''] = lines;
    if (fullName) return { fullName, headline };
  }
  return undefined;
}

/** Leaf text in document order, without buttons and boilerplate. */
function textLines(root: Element): string[] {
  return Array.from(root.querySelectorAll('*'))
    .filter((node) => node.children.length === 0 && !node.closest('button'))
    .map((node) => textOf(node) ?? '')
    .filter((line) => line && !NOISE_LINE.test(line));
}
