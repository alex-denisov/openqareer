import { escapeHtml } from './catalogHtml';
import type { StructuredNode } from './vacancyCatalogPage';

/** Metadata comes from the same evidence-backed node used by the catalog projection. */
function propertyMarkup(name: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => propertyMarkup(name, item)).join('');
  const property = `itemprop="${escapeHtml(name)}"`;
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    const type = typeof node['@type'] === 'string'
      ? ` itemtype="https://schema.org/${escapeHtml(node['@type'])}"`
      : '';
    return `<span hidden ${property} itemscope${type}>${Object.entries(node)
      .filter(([key]) => !key.startsWith('@'))
      .map(([key, nested]) => propertyMarkup(key, nested))
      .join('')}</span>`;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  return `<meta ${property} content="${escapeHtml(String(value))}">`;
}

/** Title and full description are marked on visible content, so they are never duplicated. */
export function jobPostingMetadata(posting: StructuredNode): string {
  return Object.entries(posting)
    .filter(([name]) => !name.startsWith('@') && name !== 'title' && name !== 'description')
    .map(([name, value]) => propertyMarkup(name, value))
    .join('');
}
