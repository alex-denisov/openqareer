/**
 * B647: «Исправить схему» — чистые правки схемы ответа: переименовать или
 * убрать узел (вместе с его связями), добавить или убрать связь. Исходная
 * схема не меняется, ошибка в любой правке отклоняет весь список.
 */
import { SCHEMA_MAX_LINKS, type SchemaLink, type SystemDesignSchema } from './systemDesignSchema';

export type SchemaCorrection =
  | { readonly op: 'rename_node'; readonly nodeId: string; readonly label: string }
  | { readonly op: 'remove_node'; readonly nodeId: string }
  | {
      readonly op: 'add_link';
      readonly from: string;
      readonly to: string;
      readonly label?: string;
    }
  | { readonly op: 'remove_link'; readonly from: string; readonly to: string };

export type SchemaCorrectionError =
  'unknown_node' | 'unknown_link' | 'self_link' | 'duplicate_link' | 'too_many_links';

export type SchemaCorrectionResult =
  | { readonly ok: true; readonly schema: SystemDesignSchema }
  | { readonly ok: false; readonly error: SchemaCorrectionError };

const hasNode = (schema: SystemDesignSchema, id: string): boolean =>
  schema.nodes.some((node) => node.id === id);
const sameLink = (link: SchemaLink, from: string, to: string): boolean =>
  link.from === from && link.to === to;

function addLink(
  schema: SystemDesignSchema,
  correction: Extract<SchemaCorrection, { op: 'add_link' }>,
): SchemaCorrectionResult {
  const { from, to } = correction;
  if (!hasNode(schema, from) || !hasNode(schema, to)) return { ok: false, error: 'unknown_node' };
  if (from === to) return { ok: false, error: 'self_link' };
  if (schema.links.some((link) => sameLink(link, from, to))) {
    return { ok: false, error: 'duplicate_link' };
  }
  if (schema.links.length >= SCHEMA_MAX_LINKS) return { ok: false, error: 'too_many_links' };
  const link: SchemaLink = correction.label
    ? { from, to, label: correction.label, quote: null }
    : { from, to, quote: null };
  return { ok: true, schema: { ...schema, links: [...schema.links, link] } };
}

export function applySchemaCorrection(
  schema: SystemDesignSchema,
  correction: SchemaCorrection,
): SchemaCorrectionResult {
  switch (correction.op) {
    case 'rename_node':
      if (!hasNode(schema, correction.nodeId)) return { ok: false, error: 'unknown_node' };
      return {
        ok: true,
        schema: {
          ...schema,
          nodes: schema.nodes.map((node) =>
            node.id === correction.nodeId ? { ...node, label: correction.label } : node,
          ),
        },
      };
    case 'remove_node':
      if (!hasNode(schema, correction.nodeId)) return { ok: false, error: 'unknown_node' };
      return {
        ok: true,
        schema: {
          nodes: schema.nodes.filter((node) => node.id !== correction.nodeId),
          links: schema.links.filter(
            (link) => link.from !== correction.nodeId && link.to !== correction.nodeId,
          ),
        },
      };
    case 'add_link':
      return addLink(schema, correction);
    case 'remove_link':
      if (!schema.links.some((link) => sameLink(link, correction.from, correction.to))) {
        return { ok: false, error: 'unknown_link' };
      }
      return {
        ok: true,
        schema: {
          ...schema,
          links: schema.links.filter((link) => !sameLink(link, correction.from, correction.to)),
        },
      };
  }
}

export function applySchemaCorrections(
  schema: SystemDesignSchema,
  corrections: readonly SchemaCorrection[],
): SchemaCorrectionResult {
  return corrections.reduce<SchemaCorrectionResult>(
    (result, correction) => (result.ok ? applySchemaCorrection(result.schema, correction) : result),
    { ok: true, schema },
  );
}
