import { htmlToFeedText } from '../../connectors/feedText';

/**
 * schema.org JobPosting со страницы вакансии (B641). Перенос `jsonld.go`
 * проекта github.com/strelov1/freehire (MIT, © 2026 freehire contributors):
 * узел ищется в любой форме блока — сам объект, массив узлов, `@graph` или
 * `mainEntity` у WebPage.
 */
export interface JsonLdPosting {
  readonly title: string;
  readonly company: string;
  readonly description: string;
  readonly location: string;
  readonly datePosted: string;
  readonly remote: boolean;
  readonly identifier: string;
}

type Node = Record<string, unknown>;

const SCRIPT_RE = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

function isJobPosting(node: Node): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && t.toLowerCase() === 'jobposting');
}

function postingNodes(parsed: unknown): Node[] {
  if (Array.isArray(parsed)) return parsed.filter(isNode).filter(isJobPosting);
  if (!isNode(parsed)) return [];
  if (isJobPosting(parsed)) return [parsed];
  const graph = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [];
  const fromGraph = graph.filter(isNode).filter(isJobPosting);
  if (fromGraph.length > 0) return fromGraph;
  const main = parsed.mainEntity;
  return isNode(main) && isJobPosting(main) ? [main] : [];
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function placeName(place: unknown): string {
  if (typeof place === 'string') return place;
  if (!isNode(place)) return '';
  return list(place.address)
    .map((address) => {
      if (typeof address === 'string') return address;
      if (!isNode(address)) return '';
      const country = isNode(address.addressCountry)
        ? str(address.addressCountry.name)
        : str(address.addressCountry);
      return [str(address.addressLocality), str(address.addressRegion), country]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean)
    .join('; ');
}

function toPosting(node: Node): JsonLdPosting {
  const org = isNode(node.hiringOrganization)
    ? str(node.hiringOrganization.name)
    : str(node.hiringOrganization);
  const ident = isNode(node.identifier) ? str(node.identifier.value) : str(node.identifier);
  const location = list(node.jobLocation).map(placeName).filter(Boolean).join('; ');
  return {
    title: htmlToFeedText(str(node.title) || str(node.name)).trim(),
    company: htmlToFeedText(org).trim(),
    description: str(node.description),
    location,
    datePosted: str(node.datePosted),
    remote: /telecommute/i.test(str(node.jobLocationType)),
    identifier: ident,
  };
}

/** Управляющие символы (код < 32) внутри строк ломают JSON.parse у части сайтов. */
function stripControlChars(raw: string): string {
  let out = '';
  for (const ch of raw) out += ch.charCodeAt(0) < 32 ? ' ' : ch;
  return out;
}

/** Каждый JobPosting страницы, в порядке появления. */
export function readJsonLdPostings(html: string): JsonLdPosting[] {
  const out: JsonLdPosting[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    const body = (match[1] ?? '').trim();
    if (!body) continue;
    try {
      // Управляющие символы внутри строк ломают JSON.parse у части сайтов (freehire flexjson).
      const parsed: unknown = JSON.parse(stripControlChars(body));
      out.push(...postingNodes(parsed).map(toPosting));
    } catch {
      // Невалидный блок разметки — не вакансия; остальные блоки страницы читаются.
    }
  }
  return out;
}
