/**
 * B647: тело PUT «Исправить схему» — список правок или схема целиком.
 * Цитаты кандидат не присылает: у знакомых узлов и связей они берутся из
 * текущей схемы, у новых — null.
 */
import { z } from 'zod';
import {
  SCHEMA_LABEL_LIMIT,
  SCHEMA_MAX_LINKS,
  SCHEMA_MAX_NODES,
  SCHEMA_NODE_KINDS,
  type SchemaLink,
  type SystemDesignSchema,
} from '../domain/systemDesignSchema';
import {
  applySchemaCorrections,
  type SchemaCorrectionResult,
} from '../domain/systemDesignSchemaCorrection';

const nodeIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/u);
const labelSchema = z.string().trim().min(1).max(SCHEMA_LABEL_LIMIT);

const correctionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename_node'), nodeId: nodeIdSchema, label: labelSchema }).strict(),
  z.object({ op: z.literal('remove_node'), nodeId: nodeIdSchema }).strict(),
  z
    .object({
      op: z.literal('add_link'),
      from: nodeIdSchema,
      to: nodeIdSchema,
      label: labelSchema.optional(),
    })
    .strict(),
  z.object({ op: z.literal('remove_link'), from: nodeIdSchema, to: nodeIdSchema }).strict(),
]);

const fullSchemaSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({ id: nodeIdSchema, label: labelSchema, kind: z.enum(SCHEMA_NODE_KINDS) })
          .strict(),
      )
      .max(SCHEMA_MAX_NODES),
    links: z
      .array(
        z.object({ from: nodeIdSchema, to: nodeIdSchema, label: labelSchema.optional() }).strict(),
      )
      .max(SCHEMA_MAX_LINKS),
  })
  .strict();

export const schemaPutBodySchema = z.union([
  z.object({ corrections: z.array(correctionSchema).min(1).max(SCHEMA_MAX_LINKS) }).strict(),
  z.object({ schema: fullSchemaSchema }).strict(),
]);
export type SchemaPutBody = z.infer<typeof schemaPutBodySchema>;

type FullSchemaInput = z.infer<typeof fullSchemaSchema>;

function fullSchemaError(input: FullSchemaInput): SchemaCorrectionResult | null {
  const ids = new Set(input.nodes.map((node) => node.id));
  if (ids.size !== input.nodes.length) return { ok: false, error: 'duplicate_node' };
  if (input.links.some((link) => !ids.has(link.from) || !ids.has(link.to))) {
    return { ok: false, error: 'unknown_node' };
  }
  if (input.links.some((link) => link.from === link.to)) return { ok: false, error: 'self_link' };
  const pairs = new Set(input.links.map((link) => `${link.from}>${link.to}`));
  return pairs.size === input.links.length ? null : { ok: false, error: 'duplicate_link' };
}

function fromFullSchema(
  input: FullSchemaInput,
  base: SystemDesignSchema | null,
): SchemaCorrectionResult {
  const error = fullSchemaError(input);
  if (error) return error;
  const quoteOfNode = new Map(base?.nodes.map((node) => [node.id, node.quote]) ?? []);
  const quoteOfLink = new Map(base?.links.map((link) => [`${link.from}>${link.to}`, link.quote]));
  const links: SchemaLink[] = input.links.map((link) => ({
    ...link,
    quote: quoteOfLink.get(`${link.from}>${link.to}`) ?? null,
  }));
  return {
    ok: true,
    schema: {
      nodes: input.nodes.map((node) => ({ ...node, quote: quoteOfNode.get(node.id) ?? null })),
      links,
    },
  };
}

/** Новая схема из тела PUT; правки без текущей схемы невозможны. */
export function correctedSchema(
  body: SchemaPutBody,
  base: SystemDesignSchema | null,
): SchemaCorrectionResult | { readonly ok: false; readonly error: 'missing' } {
  if ('schema' in body) return fromFullSchema(body.schema, base);
  if (!base) return { ok: false, error: 'missing' };
  return applySchemaCorrections(base, body.corrections);
}
